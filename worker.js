(function (main) {
  const ENVIRONMENT_IS_NODE =
    typeof process === 'object' && process !== null &&
    typeof process.versions === 'object' && process.versions !== null &&
    typeof process.versions.node === 'string'

  if (ENVIRONMENT_IS_NODE) {
    const _require = function (request) {
      return require(request)
    }

    const _init = function () {
      const nodeWorkerThreads = require('worker_threads')
      const parentPort = nodeWorkerThreads.parentPort

      parentPort.on('message', (data) => {
        globalThis.onmessage({ data })
      })

      Object.assign(globalThis, {
        self: globalThis,
        require,
        Worker: nodeWorkerThreads.Worker,
        importScripts: function (f) {
          (0, eval)(require('fs').readFileSync(f, 'utf8') + '//# sourceURL=' + f)
        },
        postMessage: function (msg) {
          parentPort.postMessage(msg)
        }
      })
    }

    main(_require, _init)
  } else {
    importScripts('./node_modules/@tybys/wasm-util/dist/wasm-util.js')
    importScripts('./node_modules/@emnapi/wasi-threads/dist/wasi-threads.js')

    const nodeWasi = { WASI: globalThis.wasmUtil.WASI }
    const _require = function (request) {
      if (request === '@emnapi/wasi-threads') return globalThis.wasiThreads
      if (request === 'node:wasi' || request === 'wasi') return nodeWasi
      throw new Error('Can not find module: ' + request)
    }
    const _init = function () {}
    main(_require, _init)
  }
})(function main (require, init) {
  init()

  const { WASI } = require('wasi')
  const { ThreadMessageHandler, WASIThreads } = require('@emnapi/wasi-threads')

  const handler = new ThreadMessageHandler({
    async onLoad ({ wasmModule, wasmMemory }) {
      const wasi = new WASI({
        version: 'preview1'
      })

      const wasiThreads = new WASIThreads({
        wasi,
        childThread: true
      })

      const originalInstance = await WebAssembly.instantiate(wasmModule, {
        env: {
          memory: wasmMemory,
        },
        wasi_snapshot_preview1: wasi.wasiImport,
        ...wasiThreads.getImportObject()
      })

      // must call `initialize` instead of `start` in child thread
      const instance = wasiThreads.initialize(originalInstance, wasmModule, wasmMemory)

      return { module: wasmModule, instance }
    }
  })

  globalThis.onmessage = function (e) {
    handler.handle(e)
    // handle other messages
  }
})

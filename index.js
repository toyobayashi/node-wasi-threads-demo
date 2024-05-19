const ENVIRONMENT_IS_NODE =
  typeof process === 'object' && process !== null &&
  typeof process.versions === 'object' && process.versions !== null &&
  typeof process.versions.node === 'string';

(function (main) {
  if (ENVIRONMENT_IS_NODE) {
    main(require)
  } else {
    if (typeof importScripts === 'function') {
      importScripts('./node_modules/@tybys/wasm-util/dist/wasm-util.js')
      importScripts('./node_modules/@emnapi/wasi-threads/dist/wasi-threads.js')
    }
    const nodeWasi = { WASI: globalThis.wasmUtil.WASI }
    const nodeWorkerThreads = {
      Worker: globalThis.Worker
    }
    const _require = function (request) {
      if (request === 'node:wasi' || request === 'wasi') return nodeWasi
      if (request === 'node:worker_threads' || request === 'worker_threads') return nodeWorkerThreads
      if (request === '@emnapi/wasi-threads') return globalThis.wasiThreads
      throw new Error('Can not find module: ' + request)
    }
    main(_require)
  }
})(async function (require) {
  const { WASI } = require('wasi')
  const { Worker } = require('worker_threads')
  const { WASIThreads } = require('@emnapi/wasi-threads')

  const wasi = new WASI({
    version: 'preview1'
  })
  const wasiThreads = new WASIThreads({
    wasi,

    /**
     * avoid Atomics.wait() deadlock during thread creation in browser
     * see https://emscripten.org/docs/tools_reference/settings_reference.html#pthread-pool-size
     */
    reuseWorker: ENVIRONMENT_IS_NODE
      ? false
      : {
          size: 4 /** greater than actual needs (2) */,
          strict: true
        },

    /**
     * Synchronous thread creation
     * pthread_create will not return until thread worker actually starts
     */
    waitThreadStart: typeof window === 'undefined' ? 1000 : false,

    onCreateWorker: () => {
      return new Worker('./worker.js', {
        execArgv: ['--experimental-wasi-unstable-preview1']
      })
    }
  })
  const memory = new WebAssembly.Memory({
    initial: 16777216 / 65536,
    maximum: 2147483648 / 65536,
    shared: true
  })
  let input
  const file = './main.wasm'
  try {
    input = require('fs').readFileSync(require('path').join(__dirname, file))
  } catch (err) {
    const response = await fetch(file)
    input = await response.arrayBuffer()
  }
  let { module, instance } = await WebAssembly.instantiate(input, {
    env: { memory },
    wasi_snapshot_preview1: wasi.wasiImport,
    ...wasiThreads.getImportObject()
  })

  wasiThreads.setup(instance, module, memory)
  await wasiThreads.preloadWorkers()

  if (typeof instance.exports._start === 'function') {
    return wasi.start(instance)
  } else {
    wasi.initialize(instance)
    // instance.exports.exported_wasm_function()
  }
})

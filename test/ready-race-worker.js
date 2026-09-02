'use strict'

const { parentPort, workerData } = require('node:worker_threads')
const { WRITE_INDEX, READ_INDEX } = require('../lib/indexes')

const state = new Int32Array(workerData.stateBuf)

parentPort.on('message', (msg) => {
  if (msg?.code === 'ADVANCE') {
    const end = Atomics.load(state, WRITE_INDEX)
    Atomics.store(state, READ_INDEX, end)
    Atomics.notify(state, READ_INDEX)
  } else if (msg?.code === 'SHUTDOWN') {
    process.exit(0)
  }
})

parentPort.postMessage({ code: 'READY' })
parentPort.postMessage({
  code: 'EVENT',
  name: 'write-more'
})

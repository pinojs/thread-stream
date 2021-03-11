'use strict'

const { workerData, parentPort } = require('worker_threads')
const { WRITE_INDEX, READ_INDEX } = require('./indexes')
const fn = require(workerData.filename)

const {
  dataBuf,
  stateBuf
} = workerData

let destination

const state = new Int32Array(stateBuf)
const data = Buffer.from(dataBuf)

async function start () {
  destination = await fn(workerData.workerData)

  destination.on('finish', function () {
    parentPort.postMessage({
      code: 'FINISH'
    })
  })

  destination.on('close', function () {
    setImmediate(() => {
      process.exit(0)
    })
  })
}

start().then(function () {
  parentPort.postMessage({
    code: 'READY'
  })

  process.nextTick(run)
})

function run () {
  let current = Atomics.load(state, READ_INDEX)
  let end = Atomics.load(state, WRITE_INDEX)

  // process._rawDebug(`pre state ${current} ${end}`)

  if (end === current) {
    Atomics.wait(state, WRITE_INDEX, end)
    end = Atomics.load(state, WRITE_INDEX)
    current = Atomics.load(state, READ_INDEX)
  }

  // process._rawDebug(`post state ${current} ${end}`)

  if (end === -1) {
    // process._rawDebug('end')
    destination.end()
    return
  }

  const toWrite = data.toString('utf8', current, end)

  destination.write(toWrite, function () {
    Atomics.store(state, READ_INDEX, end)
    Atomics.notify(state, READ_INDEX)
    run()
  })
}

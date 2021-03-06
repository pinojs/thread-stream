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
    process.exit(0)
  })
}

start().then(function () {
  parentPort.postMessage({
    code: 'READY'
  })

  process.nextTick(run, 0)
})

function run (current) {
  let end = Atomics.load(state, WRITE_INDEX)

  // process._rawDebug(`state ${current} ${end} ${Atomics.load(state, READ_INDEX)}`)
  if (end === current) {
    Atomics.wait(state, WRITE_INDEX, end)
    end = Atomics.load(state, WRITE_INDEX)
  }

  if (end === -1) {
    destination.end()
    return
  }

  const toWrite = data.toString('utf8', current, end)

  destination.write(toWrite, function () {
    Atomics.store(state, READ_INDEX, end)
    Atomics.notify(state, READ_INDEX)
    run(end)
  })
}

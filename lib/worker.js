'use strict'

const { workerData, parentPort } = require('worker_threads')
const { WRITE_INDEX, READ_INDEX } = require('./indexes')
const { waitDiff } = require('./wait')

const {
  dataBuf,
  stateBuf
} = workerData

let destination

const state = new Int32Array(stateBuf)
const data = Buffer.from(dataBuf)

async function start () {
  const fn = (await import(workerData.filename)).default
  destination = await fn(workerData.workerData)

  destination.on('error', function (err) {
    parentPort.postMessage({
      code: 'ERROR',
      err
    })
  })

  destination.on('close', function () {
    // process._rawDebug('worker close emitted')
    const end = Atomics.load(state, WRITE_INDEX)
    Atomics.store(state, READ_INDEX, end)
    Atomics.notify(state, READ_INDEX)
    setImmediate(() => {
      process.exit(0)
    })
  })
}

// No .catch() handler,
// in case there is an error it goes
// to unhandledRejection
start().then(function () {
  parentPort.postMessage({
    code: 'READY'
  })

  process.nextTick(run)
})

function run () {
  const current = Atomics.load(state, READ_INDEX)
  const end = Atomics.load(state, WRITE_INDEX)

  // process._rawDebug(`pre state ${current} ${end}`)

  if (end === current) {
    if (end === data.length) {
      waitDiff(state, READ_INDEX, end, Infinity, run)
    } else {
      waitDiff(state, WRITE_INDEX, end, Infinity, run)
    }
    return
  }

  // process._rawDebug(`post state ${current} ${end}`)

  if (end === -1) {
    // process._rawDebug('end')
    destination.end()
    return
  }

  const toWrite = data.toString('utf8', current, end)
  // process._rawDebug('worker writing: ' + toWrite)

  const res = destination.write(toWrite)

  if (res) {
    Atomics.store(state, READ_INDEX, end)
    Atomics.notify(state, READ_INDEX)
    setImmediate(run)
  } else {
    destination.once('drain', function () {
      Atomics.store(state, READ_INDEX, end)
      Atomics.notify(state, READ_INDEX)
      run()
    })
  }
}

process.on('unhandledRejection', function (err) {
  parentPort.postMessage({
    code: 'ERROR',
    err
  })
  process.exit(1)
})

process.on('uncaughtException', function (err) {
  parentPort.postMessage({
    code: 'ERROR',
    err
  })
  process.exit(1)
})

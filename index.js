'use strict'

const { EventEmitter } = require('events')
const { Worker } = require('worker_threads')
const { join } = require('path')
const {
  WRITE_INDEX,
  READ_INDEX
} = require('./lib/indexes')

function createWorker (stream, opts) {
  const { filename, workerData } = opts

  const toExecute = join(__dirname, 'lib', 'worker.js')

  const worker = new Worker(toExecute, {
    workerData: {
      filename,
      dataBuf: stream._dataBuf,
      stateBuf: stream._stateBuf,
      workerData
    }
  })

  return worker
}

class ThreadStream extends EventEmitter {
  constructor (opts) {
    super()

    this._stateBuf = new SharedArrayBuffer(128)
    this._state = new Int32Array(this._stateBuf)
    this._dataBuf = new SharedArrayBuffer(opts.bufferSize || 4 * 1024 * 1024)
    this._data = Buffer.from(this._dataBuf)
    this.worker = createWorker(this, opts)
    this.ready = false
    this.ending = false

    this.buf = ''

    this.worker.on('message', (msg) => {
      switch (msg.code) {
        case 'READY':
          this.ready = true
          if (this.buf.length > 0) {
            this.write(this.buf)
            this.buf = ''
          }
          this.emit('ready')
          if (this.ending) {
            this.end()
          }
          break
        case 'FINISH':
          this.emit('finish')
          break
        default:
          throw new Error('this should not happen: ' + msg.code)
      }
    })

    this.worker.on('exit', () => {
      this.emit('close')
    })
  }

  write (data) {
    if (!this.ready) {
      this.buf += data
      return true
    }

    // TODO handle overflow
    const current = Atomics.load(this._state, WRITE_INDEX)
    this._data.write(data, current)
    Atomics.store(this._state, WRITE_INDEX, current + Buffer.byteLength(data))
    Atomics.notify(this._state, WRITE_INDEX)
    return true
  }

  end () {
    this.ending = true
    if (!this.ready) {
      return
    }

    // this must be loop
    const readIndex = Atomics.load(this._state, READ_INDEX)
    Atomics.wait(this._state, READ_INDEX, readIndex)

    Atomics.store(this._state, WRITE_INDEX, -1)
    Atomics.notify(this._state, WRITE_INDEX)
  }
}

module.exports = ThreadStream

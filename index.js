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

    if (data.length >= this._data.length) {
      // We are not splitting the string in two to avoid dealing
      // with truncated utf-8 chunks, therefore we cannot write
      // a string longer than the buffer.
      throw new Error('The SharedArrayBuffer is too small')
    }

    let current = Atomics.load(this._state, WRITE_INDEX)
    const length = Buffer.byteLength(data)
    if (current + length >= this._data.length) {
      // Handle overflow cases, we need to go back
      // at the beginning of the buffer to write the string.
      this.flushSync()
      Atomics.store(this._state, READ_INDEX, 0)
      Atomics.store(this._state, WRITE_INDEX, 0)
      current = 0
    }
    this._data.write(data, current)
    Atomics.store(this._state, WRITE_INDEX, current + length)
    Atomics.notify(this._state, WRITE_INDEX)
    return true
  }

  end () {
    this.ending = true
    if (!this.ready) {
      return
    }

    this.flushSync()

    // process._rawDebug('writing index')
    Atomics.store(this._state, WRITE_INDEX, -1)
    // process._rawDebug(`(end) readIndex (${Atomics.load(this._state, READ_INDEX)}) writeIndex (${Atomics.load(this._state, WRITE_INDEX)})`)
    Atomics.notify(this._state, WRITE_INDEX)
  }

  flushSync () {
    while (true) {
      const readIndex = Atomics.load(this._state, READ_INDEX)
      const writeIndex = Atomics.load(this._state, WRITE_INDEX)
      //  process._rawDebug(`(flushSync) readIndex (${readIndex}) writeIndex (${writeIndex})`)
      if (readIndex !== writeIndex) {
        // TODO: add a timeout
        Atomics.wait(this._state, READ_INDEX, readIndex)
      } else {
        break
      }
    }
  }
}

module.exports = ThreadStream

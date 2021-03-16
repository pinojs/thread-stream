'use strict'

const { EventEmitter } = require('events')
const { Worker } = require('worker_threads')
const { join } = require('path')
const wait = require('./lib/wait')
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

function drain (stream) {
  stream.needDrain = false
  stream.emit('drain')
}

class ThreadStream extends EventEmitter {
  constructor (opts = {}) {
    super()

    this._stateBuf = new SharedArrayBuffer(128)
    this._state = new Int32Array(this._stateBuf)
    this._dataBuf = new SharedArrayBuffer(opts.bufferSize || 4 * 1024 * 1024)
    this._data = Buffer.from(this._dataBuf)
    this._sync = opts.sync === undefined ? true : opts.sync
    this.worker = createWorker(this, opts)
    this.ready = false
    this.ending = false
    this.needDrain = false

    this.buf = ''

    this.worker.on('message', (msg) => {
      switch (msg.code) {
        case 'READY':
          this.ready = true
          if (this.buf.length > 0) {
            const toWrite = this.buf
            this.buf = ''
            this.write(toWrite)
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
      setImmediate(() => {
        this.emit('close')
      })
    })
  }

  _write (data, cb) {
    // data is smaller than the shared buffer length
    const current = Atomics.load(this._state, WRITE_INDEX)
    const length = Buffer.byteLength(data)
    this._data.write(data, current)
    Atomics.store(this._state, WRITE_INDEX, current + length)
    Atomics.notify(this._state, WRITE_INDEX)
    cb()
    return true
  }

  write (data) {
    if (!this.ready || this.flushing) {
      this.buf += data
      // TODO this should return false
      return true
    }

    const cb = () => {
      if (!this.needDrain) {
        // process._rawDebug('emitting drain')
        this.needDrain = true
        process.nextTick(drain, this)
      }
    }

    if (this._sync) {
      while (data.length !== 0) {
        const writeIndex = Atomics.load(this._state, WRITE_INDEX)
        const leftover = this._data.length - writeIndex
        if (leftover === 0) {
          this.flushSync()
          Atomics.store(this._state, READ_INDEX, 0)
          Atomics.store(this._state, WRITE_INDEX, 0)
          continue
        } else if (leftover < 0) {
          throw new Error('overwritten')
        }

        // TODO handle truncated utf-8 chunks
        const toWrite = data.slice(0, leftover)
        this._write(toWrite, cb)
        data = data.slice(leftover)
      }

      return true
    }

    const next = () => {
      const writeIndex = Atomics.load(this._state, WRITE_INDEX)
      const leftover = this._data.length - writeIndex

      if (leftover > 0) {
        if (this.buf.length === 0) {
          this.flushing = false
          cb()
          return
        }
        // TODO handle truncated utf-8 chunks
        const toWrite = this.buf.slice(0, leftover)
        this.buf = this.buf.slice(leftover)
        this._write(toWrite, next)
      } else if (leftover === 0) {
        this.flush(() => {
          Atomics.store(this._state, READ_INDEX, 0)
          Atomics.store(this._state, WRITE_INDEX, 0)
          next()
        })
      } else {
        throw new Error('overwritten')
      }
    }

    this.buf = data
    this.flushing = true
    next()

    return false
  }

  end () {
    this.ending = true
    if (!this.ready) {
      return
    }

    if (this.flushing) {
      this.once('drain', this.end.bind(this))
      return
    }

    this.flushSync()

    // process._rawDebug('end...!')

    // process._rawDebug('writing index')
    Atomics.store(this._state, WRITE_INDEX, -1)
    // process._rawDebug(`(end) readIndex (${Atomics.load(this._state, READ_INDEX)}) writeIndex (${Atomics.load(this._state, WRITE_INDEX)})`)
    Atomics.notify(this._state, WRITE_INDEX)
  }

  flush (cb) {
    const writeIndex = Atomics.load(this._state, WRITE_INDEX)
    wait(this._state, READ_INDEX, writeIndex, Infinity, (err, res) => {
      if (err) {
        this.emit('error', err)
      }
      if (res === 'not-equal') {
        // TODO handle deadlock
        this.flush(cb)
        return
      }
      cb()
    })
  }

  flushSync () {
    const writeIndex = Atomics.load(this._state, WRITE_INDEX)

    // TODO handle deadlock
    while (true) {
      const readIndex = Atomics.load(this._state, READ_INDEX)
      // process._rawDebug(`(flushSync) readIndex (${readIndex}) writeIndex (${writeIndex})`)
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

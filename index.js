'use strict'

const { EventEmitter } = require('events')
const { Worker } = require('worker_threads')
const { join } = require('path')
const { pathToFileURL } = require('url')
const { wait } = require('./lib/wait')
const {
  WRITE_INDEX,
  READ_INDEX
} = require('./lib/indexes')

function createWorker (stream, opts) {
  const { filename, workerData } = opts

  const toExecute = join(__dirname, 'lib', 'worker.js')

  const worker = new Worker(toExecute, {
    workerData: {
      filename: filename.indexOf('file://') === 0
        ? filename
        : pathToFileURL(filename).href,
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

function nextFlush (stream) {
  const writeIndex = Atomics.load(stream._state, WRITE_INDEX)
  const leftover = stream._data.length - writeIndex

  if (leftover > 0) {
    if (stream.buf.length === 0) {
      stream.flushing = false
      if (!stream.needDrain) {
        // process._rawDebug('emitting drain')
        stream.needDrain = true
        process.nextTick(drain, stream)
      }
      return
    }
    // TODO handle truncated utf-8 chunks
    const toWrite = stream.buf.slice(0, leftover)
    stream.buf = stream.buf.slice(leftover)
    stream._write(toWrite, nextFlush.bind(null, stream))
  } else if (leftover === 0) {
    if (writeIndex === 0 && stream.buf.length === 0) {
      // we had a flushSync in the meanwhile
      return
    }
    stream.flush(() => {
      Atomics.store(stream._state, READ_INDEX, 0)
      Atomics.store(stream._state, WRITE_INDEX, 0)
      nextFlush(stream)
    })
  } else {
    throw new Error('overwritten')
  }
}

class ThreadStream extends EventEmitter {
  constructor (opts = {}) {
    super()

    this._stateBuf = new SharedArrayBuffer(128)
    this._state = new Int32Array(this._stateBuf)
    this._dataBuf = new SharedArrayBuffer(opts.bufferSize || 4 * 1024 * 1024)
    this._data = Buffer.from(this._dataBuf)
    this._sync = opts.sync || false
    this.worker = createWorker(this, opts)
    this.ready = false
    this.ending = false
    this.needDrain = false

    this.buf = ''

    this.worker.on('message', (msg) => {
      switch (msg.code) {
        case 'READY':
          this.ready = true
          this.emit('ready')
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

  _hasSpace () {
    const current = Atomics.load(this._state, WRITE_INDEX)
    return this._data.length - this.buf.length - current > 0
  }

  write (data) {
    if (!this.ready || this.flushing) {
      this.buf += data
      // TODO if this.flushing, we must follow highWaterMark
      return this._hasSpace()
    }

    if (this._sync) {
      this.buf += data
      this._writeSync()

      return true
    }

    this.buf = data
    this.flushing = true
    setImmediate(nextFlush, this)

    return this._hasSpace()
  }

  end () {
    if (!this.ready) {
      this.once('ready', this.end.bind(this))
      return
    }

    if (this.flushing) {
      this.once('drain', this.end.bind(this))
      return
    }

    if (this.ending) {
      return
    }
    this.ending = true

    this.flushSync()

    // process._rawDebug('writing index')
    Atomics.store(this._state, WRITE_INDEX, -1)
    // process._rawDebug(`(end) readIndex (${Atomics.load(this._state, READ_INDEX)}) writeIndex (${Atomics.load(this._state, WRITE_INDEX)})`)
    Atomics.notify(this._state, WRITE_INDEX)
    // process._rawDebug('end finished...')
  }

  flush (cb) {
    // TODO write all .buf
    const writeIndex = Atomics.load(this._state, WRITE_INDEX)
    // process._rawDebug(`(flush) readIndex (${Atomics.load(this._state, READ_INDEX)}) writeIndex (${Atomics.load(this._state, WRITE_INDEX)})`)
    wait(this._state, READ_INDEX, writeIndex, Infinity, (err, res) => {
      if (err) {
        this.emit('error', err)
        cb(err)
        return
      }
      if (res === 'not-equal') {
        // TODO handle deadlock
        this.flush(cb)
        return
      }
      cb()
    })
  }

  _writeSync () {
    const cb = () => {
      if (!this.needDrain) {
        // process._rawDebug('emitting drain')
        this.needDrain = true
        process.nextTick(drain, this)
      }
    }
    this.flushing = false

    while (this.buf.length !== 0) {
      const writeIndex = Atomics.load(this._state, WRITE_INDEX)
      const leftover = this._data.length - writeIndex
      if (leftover === 0) {
        this._flushSync()
        Atomics.store(this._state, READ_INDEX, 0)
        Atomics.store(this._state, WRITE_INDEX, 0)
        continue
      } else if (leftover < 0) {
        throw new Error('overwritten')
      }

      // TODO handle truncated utf-8 chunks
      const toWrite = this.buf.slice(0, leftover)
      this.buf = this.buf.slice(leftover)
      // process._rawDebug('writing ' + toWrite.length)
      this._write(toWrite, cb)
    }
  }

  flushSync () {
    this._writeSync()
    this._flushSync()
  }

  _flushSync () {
    if (this.flushing) {
      throw new Error('unable to flush while flushing')
    }

    // process._rawDebug('flushSync started')

    const writeIndex = Atomics.load(this._state, WRITE_INDEX)

    let spins = 10

    // TODO handle deadlock
    while (true) {
      const readIndex = Atomics.load(this._state, READ_INDEX)
      // process._rawDebug(`(flushSync) readIndex (${readIndex}) writeIndex (${writeIndex})`)
      if (readIndex !== writeIndex) {
        // TODO this timeouts for some reason.
        Atomics.wait(this._state, READ_INDEX, readIndex, 1000)
      } else {
        break
      }

      if (++spins === 10) {
        throw new Error('_flushSync took too long (10s)')
      }
    }
    // process._rawDebug('flushSync finished')
  }
}

module.exports = ThreadStream

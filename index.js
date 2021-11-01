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
const buffer = require('buffer')
const assert = require('assert')

// V8 limit for string size
const MAX_STRING = buffer.constants.MAX_STRING_LENGTH

class FakeWeakRef {
  constructor (value) {
    this._value = value
  }

  deref () {
    return this._value
  }
}

const FinalizationRegistry = global.FinalizationRegistry || class FakeFinalizationRegistry {
  register () {}
  unregister () {}
}

const WeakRef = global.WeakRef || FakeWeakRef

const registry = new FinalizationRegistry((worker) => {
  if (worker.exited) {
    return
  }
  worker.terminate()
})

function createWorker (stream, opts) {
  const { filename, workerData } = opts

  const toExecute = join(__dirname, 'lib', 'worker.js')

  const worker = new Worker(toExecute, {
    ...opts.workerOpts,
    workerData: {
      filename: filename.indexOf('file://') === 0
        ? filename
        : pathToFileURL(filename).href,
      dataBuf: stream._dataBuf,
      stateBuf: stream._stateBuf,
      workerData
    }
  })

  // We keep a strong reference for now,
  // we need to start writing first
  worker.stream = new FakeWeakRef(stream)

  worker.on('message', onWorkerMessage)
  worker.on('exit', onWorkerExit)
  registry.register(stream, worker)

  return worker
}

function drain (stream) {
  assert(!stream._sync)
  stream.needDrain = false
  stream.emit('drain')
}

function nextFlush (stream) {
  const writeIndex = Atomics.load(stream._state, WRITE_INDEX)
  let leftover = stream._data.length - writeIndex

  if (leftover > 0) {
    if (stream.buf.length === 0) {
      stream.flushing = false

      if (stream.ending) {
        stream._end()
      } else if (stream.needDrain) {
        process.nextTick(drain, stream)
      }

      return
    }

    let toWrite = stream.buf.slice(0, leftover)
    let toWriteBytes = Buffer.byteLength(toWrite)
    if (toWriteBytes <= leftover) {
      stream.buf = stream.buf.slice(leftover)
      // process._rawDebug('writing ' + toWrite.length)
      stream._write(toWrite, nextFlush.bind(null, stream))
    } else {
      // multi-byte utf-8
      stream.flush(() => {
        Atomics.store(stream._state, READ_INDEX, 0)
        Atomics.store(stream._state, WRITE_INDEX, 0)

        // Find a toWrite length that fits the buffer
        // it must exists as the buffer is at least 4 bytes length
        // and the max utf-8 length for a char is 4 bytes.
        while (toWriteBytes > stream.buf.length) {
          leftover = leftover / 2
          toWrite = stream.buf.slice(0, leftover)
          toWriteBytes = Buffer.byteLength(toWrite)
        }
        stream.buf = stream.buf.slice(leftover)
        stream._write(toWrite, nextFlush.bind(null, stream))
      })
    }
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
    // This should never happen
    throw new Error('overwritten')
  }
}

function onWorkerMessage (msg) {
  const stream = this.stream.deref()
  if (stream === undefined) {
    this.exited = true
    // Terminate the worker.
    this.terminate()
    return
  }

  switch (msg.code) {
    case 'READY':
      // Replace the FakeWeakRef with a
      // proper one.
      this.stream = new WeakRef(stream)
      break
    case 'ERROR':
      stream._destroy(msg.err)
      break
    default:
      throw new Error('this should not happen: ' + msg.code)
  }
}

function onWorkerExit (code) {
  const stream = this.stream.deref()
  if (stream === undefined) {
    // Nothing to do, the worker already exit
    return
  }
  registry.unregister(stream)
  stream.worker.exited = true
  stream.worker.off('exit', onWorkerExit)
  stream._destroy(code !== 0 ? new Error('The worker thread exited') : null)
}

class ThreadStream extends EventEmitter {
  constructor (opts = {}) {
    super()

    if (opts.bufferSize < 4) {
      throw new Error('bufferSize must at least fit a 4-byte utf-8 char')
    }

    this._stateBuf = new SharedArrayBuffer(128)
    this._state = new Int32Array(this._stateBuf)
    this._dataBuf = new SharedArrayBuffer(opts.bufferSize || 4 * 1024 * 1024)
    this._data = Buffer.from(this._dataBuf)
    this._sync = opts.sync || false
    this.worker = createWorker(this, opts)
    this.ending = false
    this.ended = false
    this.needDrain = false
    this.destroyed = false
    this.flushing = false

    this.buf = ''
  }

  _destroy (err) {
    if (this.destroyed) {
      return
    }
    this.destroyed = true

    if (err) {
      this.emit('error', err)
    }

    if (!this.worker.exited) {
      this.worker.terminate()
        .catch(() => {})
        .then(() => {
          this.emit('close')
        })
    } else {
      setImmediate(() => {
        this.emit('close')
      })
    }
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
    if (this.destroyed) {
      throw new Error('the worker has exited')
    }

    if (this.ending) {
      throw new Error('the worker is ending')
    }

    if (this.buf.length + data.length >= MAX_STRING) {
      try {
        this._writeSync()
        this.flushing = true
      } catch (err) {
        this._destroy(err)
        return false
      }
    }

    this.buf += data

    if (this._sync) {
      try {
        this._writeSync()
        return true
      } catch (err) {
        this._destroy(err)
        return false
      }
    }

    if (!this.flushing) {
      this.flushing = true
      setImmediate(nextFlush, this)
    }

    this.needDrain = this._data.length - this.buf.length - Atomics.load(this._state, WRITE_INDEX) <= 0
    return !this.needDrain
  }

  end () {
    if (this.destroyed) {
      throw new Error('the worker has exited')
    }

    this.ending = true
    this._end()
  }

  _end () {
    if (this.ended || !this.ending || this.flushing) {
      return
    }
    this.ended = true

    // TODO (fix): Why flushSync?
    try {
      this.flushSync()

      let readIndex = Atomics.load(this._state, READ_INDEX)

      // process._rawDebug('writing index')
      Atomics.store(this._state, WRITE_INDEX, -1)
      // process._rawDebug(`(end) readIndex (${Atomics.load(this._state, READ_INDEX)}) writeIndex (${Atomics.load(this._state, WRITE_INDEX)})`)
      Atomics.notify(this._state, WRITE_INDEX)

      // Wait for the process to complete
      let spins = 0
      while (readIndex !== -1) {
        // process._rawDebug(`read = ${read}`)
        Atomics.wait(this._state, READ_INDEX, readIndex, 1000)
        readIndex = Atomics.load(this._state, READ_INDEX)

        if (readIndex === -2) {
          throw new Error('end() failed')
        }

        if (++spins === 10) {
          throw new Error('end() took too long (10s)')
        }
      }

      process.nextTick(() => {
        this.emit('finish')
      })
    } catch (err) {
      this._destroy(err)
    }
    // process._rawDebug('end finished...')
  }

  flush (cb) {
    if (this.destroyed) {
      throw new Error('the worker has exited')
    }

    // TODO write all .buf
    const writeIndex = Atomics.load(this._state, WRITE_INDEX)
    // process._rawDebug(`(flush) readIndex (${Atomics.load(this._state, READ_INDEX)}) writeIndex (${Atomics.load(this._state, WRITE_INDEX)})`)
    wait(this._state, READ_INDEX, writeIndex, Infinity, (err, res) => {
      if (err) {
        this._destroy(err)
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
      if (this.ending) {
        this._end()
      } else if (this.needDrain) {
        process.nextTick(drain, this)
      }
    }
    this.flushing = false

    while (this.buf.length !== 0) {
      const writeIndex = Atomics.load(this._state, WRITE_INDEX)
      let leftover = this._data.length - writeIndex
      if (leftover === 0) {
        this._flushSync()
        Atomics.store(this._state, READ_INDEX, 0)
        Atomics.store(this._state, WRITE_INDEX, 0)
        continue
      } else if (leftover < 0) {
        // This should never happen
        throw new Error('overwritten')
      }

      let toWrite = this.buf.slice(0, leftover)
      let toWriteBytes = Buffer.byteLength(toWrite)
      if (toWriteBytes <= leftover) {
        this.buf = this.buf.slice(leftover)
        // process._rawDebug('writing ' + toWrite.length)
        this._write(toWrite, cb)
      } else {
        // multi-byte utf-8
        this._flushSync()
        Atomics.store(this._state, READ_INDEX, 0)
        Atomics.store(this._state, WRITE_INDEX, 0)

        // Find a toWrite length that fits the buffer
        // it must exists as the buffer is at least 4 bytes length
        // and the max utf-8 length for a char is 4 bytes.
        while (toWriteBytes > this.buf.length) {
          leftover = leftover / 2
          toWrite = this.buf.slice(0, leftover)
          toWriteBytes = Buffer.byteLength(toWrite)
        }
        this.buf = this.buf.slice(leftover)
        this._write(toWrite, cb)
      }
    }
  }

  flushSync () {
    if (this.destroyed) {
      throw new Error('the worker has exited')
    }

    this._writeSync()
    this._flushSync()
  }

  _flushSync () {
    if (this.flushing) {
      throw new Error('unable to flush while flushing')
    }

    // process._rawDebug('flushSync started')

    const writeIndex = Atomics.load(this._state, WRITE_INDEX)

    let spins = 0

    // TODO handle deadlock
    while (true) {
      const readIndex = Atomics.load(this._state, READ_INDEX)

      if (readIndex === -2) {
        throw new Error('_flushSync failed')
      }

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

  unref () {
    this.worker.unref()
  }

  ref () {
    this.worker.ref()
  }

  get writable () {
    return !this.destroyed && !this.ending
  }
}

module.exports = ThreadStream

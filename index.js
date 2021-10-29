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
  stream.needDrain = false
  stream.emit('drain')
}

function nextFlush (stream) {
  const writeIndex = Atomics.load(stream._state, WRITE_INDEX)
  let leftover = stream._data.length - writeIndex

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
      if (stream._sync) {
        stream.ready = true
        stream.flushSync()
        stream.emit('ready')
      } else {
        stream.once('drain', function () {
          stream.flush(() => {
            stream.ready = true
            stream.emit('ready')
          })
        })
        nextFlush(stream)
      }
      break
    case 'ERROR':
      stream.closed = true
      stream.worker.exited = true
      // TODO only remove our own
      stream.worker.removeAllListeners('exit')
      stream.worker.terminate().then(null, () => {})
      process.nextTick(() => {
        stream.emit('error', msg.err)
      })
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
  stream.closed = true
  stream.worker.exited = true
  setImmediate(function () {
    if (code !== 0) {
      stream.emit('error', new Error('The worker thread exited'))
    }
    stream.emit('close')
  })
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
    this.ready = false
    this.ending = false
    this.needDrain = false
    this.closed = false

    this.buf = ''
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
    if (this.closed) {
      throw new Error('the worker has exited')
    }

    if (this.flushing && this.buf.length + data.length >= MAX_STRING) {
      // process._rawDebug('write: flushing')
      this._writeSync()
      this.flushing = true // we are still flushing
    }

    if (!this.ready || this.flushing) {
      this.buf += data
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
    if (this.closed) {
      throw new Error('the worker has exited')
    }

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

    let read = Atomics.load(this._state, READ_INDEX)

    // process._rawDebug('writing index')
    Atomics.store(this._state, WRITE_INDEX, -1)
    // process._rawDebug(`(end) readIndex (${Atomics.load(this._state, READ_INDEX)}) writeIndex (${Atomics.load(this._state, WRITE_INDEX)})`)
    Atomics.notify(this._state, WRITE_INDEX)

    // Wait for the process to complete
    let spins = 0
    while (read !== -1) {
      // process._rawDebug(`read = ${read}`)
      Atomics.wait(this._state, READ_INDEX, read, 1000)
      read = Atomics.load(this._state, READ_INDEX)

      if (++spins === 10) {
        throw new Error('end() took too long (10s)')
      }
    }

    process.nextTick(() => {
      this.emit('finish')
    })
    // process._rawDebug('end finished...')
  }

  flush (cb) {
    if (this.closed) {
      throw new Error('the worker has exited')
    }

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
    if (this.closed) {
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
    return !this.closed
  }
}

module.exports = ThreadStream

'use strict'

const { test } = require('node:test')
const assert = require('node:assert')
const { join } = require('path')
const { readFile } = require('fs')
const { file } = require('./helper')
const ThreadStream = require('..')
const { MessageChannel } = require('worker_threads')
const { once } = require('events')

function readFileAsync (path) {
  return new Promise((resolve, reject) => {
    readFile(path, 'utf8', (err, data) => {
      if (err) {
        reject(err)
        return
      }
      resolve(data)
    })
  })
}

test('base sync=true', async function () {
  const dest = file()
  const stream = new ThreadStream({
    filename: join(__dirname, 'to-file.js'),
    workerData: { dest },
    sync: true
  })

  const finish = once(stream, 'finish')
  const close = once(stream, 'close')

  assert.deepStrictEqual(stream.writableObjectMode, false)
  assert.deepStrictEqual(stream.writableFinished, false)
  assert.deepStrictEqual(stream.closed, false)
  assert.deepStrictEqual(stream.writableNeedDrain, false)
  assert.ok(stream.write('hello world\n'))
  assert.ok(stream.write('something else\n'))
  assert.ok(stream.writable)

  assert.deepStrictEqual(stream.writableEnded, false)
  stream.end()
  assert.deepStrictEqual(stream.writableEnded, true)

  await finish
  assert.deepStrictEqual(stream.writableFinished, true)

  await close
  assert.deepStrictEqual(stream.closed, true)
  assert.ok(!stream.writable)

  const data = await readFileAsync(dest)
  assert.strictEqual(data, 'hello world\nsomething else\n')
})

test('overflow sync=true', async function () {
  const dest = file()
  const stream = new ThreadStream({
    bufferSize: 128,
    filename: join(__dirname, 'to-file.js'),
    workerData: { dest },
    sync: true
  })

  const close = once(stream, 'close')
  let count = 0

  function write () {
    if (count++ === 20) {
      stream.end()
      return
    }

    stream.write('aaaaaaaaaa')
    setImmediate(write)
  }

  write()

  await close
  const data = await readFileAsync(dest)
  assert.strictEqual(data.length, 200)
})

test('overflow sync=false', async function () {
  const dest = file()
  const stream = new ThreadStream({
    bufferSize: 128,
    filename: join(__dirname, 'to-file.js'),
    workerData: { dest },
    sync: false
  })

  const close = once(stream, 'close')
  let count = 0

  assert.deepStrictEqual(stream.writableNeedDrain, false)

  function write () {
    if (count++ === 20) {
      stream.end()
      return
    }

    if (!stream.write('aaaaaaaaaa')) {
      assert.deepStrictEqual(stream.writableNeedDrain, true)
    }
    setImmediate(write)
  }

  write()

  stream.on('drain', () => {
    assert.deepStrictEqual(stream.writableNeedDrain, false)
  })

  await close
  const data = await readFileAsync(dest)
  assert.strictEqual(data.length, 200)
})

test('over the bufferSize at startup', async function () {
  const dest = file()
  const stream = new ThreadStream({
    bufferSize: 10,
    filename: join(__dirname, 'to-file.js'),
    workerData: { dest },
    sync: true
  })

  const finish = once(stream, 'finish')
  const close = once(stream, 'close')

  assert.ok(stream.write('hello'))
  assert.ok(stream.write(' world\n'))
  assert.ok(stream.write('something else\n'))

  stream.end()

  await finish
  await close

  const data = await readFileAsync(dest)
  assert.strictEqual(data, 'hello world\nsomething else\n')
})

test('over the bufferSize at startup (async)', async function () {
  const dest = file()
  const stream = new ThreadStream({
    bufferSize: 10,
    filename: join(__dirname, 'to-file.js'),
    workerData: { dest },
    sync: false
  })

  const finish = once(stream, 'finish')
  const close = once(stream, 'close')

  assert.ok(stream.write('hello'))
  assert.ok(!stream.write(' world\n'))
  assert.ok(!stream.write('something else\n'))

  stream.end()

  await finish
  await close

  const data = await readFileAsync(dest)
  assert.strictEqual(data, 'hello world\nsomething else\n')
})

test('flushSync sync=false', async function () {
  const dest = file()
  const stream = new ThreadStream({
    bufferSize: 128,
    filename: join(__dirname, 'to-file.js'),
    workerData: { dest },
    sync: false
  })

  const close = once(stream, 'close')

  stream.on('drain', () => {
    stream.end()
  })

  for (let count = 0; count < 20; count++) {
    stream.write('aaaaaaaaaa')
  }
  stream.flushSync()

  await close

  const data = await readFileAsync(dest)
  assert.strictEqual(data.length, 200)
})

test('pass down MessagePorts', async function (t) {
  const { port1, port2 } = new MessageChannel()
  const stream = new ThreadStream({
    filename: join(__dirname, 'port.js'),
    workerData: { port: port1 },
    workerOpts: {
      transferList: [port1]
    },
    sync: false
  })
  t.after(() => {
    stream.end()
  })

  assert.ok(stream.write('hello world\n'))
  assert.ok(stream.write('something else\n'))

  const [strings] = await once(port2, 'message')

  assert.strictEqual(strings, 'hello world\nsomething else\n')
})

test('destroy does not error', async function () {
  const dest = file()
  const stream = new ThreadStream({
    filename: join(__dirname, 'to-file.js'),
    workerData: { dest },
    sync: false
  })

  stream.on('ready', () => {
    stream.worker.terminate()
  })

  const [err] = await once(stream, 'error')
  assert.strictEqual(err.message, 'the worker thread exited')

  await new Promise((resolve) => {
    stream.flush((err) => {
      assert.strictEqual(err.message, 'the worker has exited')
      resolve()
    })
  })

  assert.doesNotThrow(() => stream.flushSync())
  assert.doesNotThrow(() => stream.end())
})

test('syntax error', async function () {
  const stream = new ThreadStream({
    filename: join(__dirname, 'syntax-error.mjs')
  })

  const [err] = await once(stream, 'error')
  assert.strictEqual(err.message, 'Unexpected end of input')
})

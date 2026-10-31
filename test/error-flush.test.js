'use strict'

const { test } = require('node:test')
const assert = require('node:assert')
const { once } = require('node:events')
const { join } = require('path')
const { WRITE_INDEX } = require('../lib/indexes')
const ThreadStream = require('..')

test('emit error if worker stream emit error (async mode)', async function (t) {
  const stream = new ThreadStream({
    filename: join(__dirname, 'error.js'),
    sync: false
  })

  const closed = once(stream, 'close').catch(() => {})
  stream.on('error', () => {})

  await once(stream, 'ready')
  stream.write('hello world\n')

  let [err] = await once(stream, 'error')
  assert.strictEqual(err.message, 'kaboom')

  stream.write('noop');
  [err] = await once(stream, 'error')
  assert.strictEqual(err.message, 'the worker has exited')

  stream.write('noop');
  [err] = await once(stream, 'error')
  assert.strictEqual(err.message, 'the worker has exited')

  await closed
})

test('nextFlush does not crash when worker errors before flush', async function (t) {
  const stream = new ThreadStream({
    filename: join(__dirname, 'error-immediate.js'),
    sync: false
  })

  const closed = once(stream, 'close').catch(() => {})
  stream.on('error', () => {})

  await once(stream, 'ready')

  // Block the event loop
  const int32 = new Int32Array(new SharedArrayBuffer(WRITE_INDEX))
  Atomics.wait(int32, 0, 0, 50)

  // stream.destroyed is still false (ERROR not yet processed).
  // Writing triggers setImmediate(nextFlush, this).
  stream.write('data')

  // The event loop then processes pending messages before the
  // check phase:
  // 1. ERROR message → destroy → stream.destroyed = true
  // 2. check phase: nextFlush runs → loads WRITE_INDEX = -2

  await closed
})

test('nextFlush does not crash when the error sentinel is seen before the ERROR message', async function (t) {
  const stream = new ThreadStream({
    filename: join(__dirname, 'error-immediate.js'),
    sync: false
  })

  const closed = once(stream, 'close').catch(() => {})
  const errored = once(stream, 'error')

  await once(stream, 'ready')

  // Hold back worker messages so the shared WRITE_INDEX = -2 is
  // observed while stream.destroyed is still false.
  const [onMessage] = stream.worker.listeners('message')
  const queued = []
  stream.worker.removeListener('message', onMessage)
  stream.worker.on('message', (msg) => queued.push(msg))

  while (!queued.some((msg) => msg.code === 'ERROR')) {
    await new Promise((resolve) => setTimeout(resolve, 10))
  }

  stream.write('data')
  await new Promise((resolve) => setImmediate(resolve))
  assert.strictEqual(stream.destroyed, false)

  for (const msg of queued) {
    onMessage.call(stream.worker, msg)
  }

  const [err] = await errored
  assert.strictEqual(err.message, 'kaboom')
  await closed
})

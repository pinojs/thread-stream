'use strict'

const { test } = require('node:test')
const assert = require('node:assert')
const { once } = require('node:events')
const { join } = require('node:path')
const ThreadStream = require('..')

test('ready is emitted when the read index skips the startup snapshot', { timeout: 5000 }, async function (t) {
  const previousOverrides = globalThis.__bundlerPathsOverrides
  globalThis.__bundlerPathsOverrides = {
    ...previousOverrides,
    'thread-stream-worker': join(__dirname, 'ready-race-worker.js')
  }

  t.after(() => {
    globalThis.__bundlerPathsOverrides = previousOverrides
  })

  const stream = new ThreadStream({
    filename: __filename,
    sync: true
  })
  stream.on('error', () => {})

  t.after(async () => {
    if (!stream.destroyed) {
      await stream.worker.terminate()
    }
  })

  stream.on('write-more', () => {
    stream.write('b')
    stream.worker.postMessage({ code: 'ADVANCE' })
  })

  const ready = once(stream, 'ready')
  const close = once(stream, 'close')

  stream.write('a')
  await ready
  assert.strictEqual(stream.ready, true)

  stream.worker.postMessage({ code: 'SHUTDOWN' })
  await close
})

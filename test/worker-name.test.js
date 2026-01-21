'use strict'

const { test } = require('node:test')
const assert = require('node:assert')
const { join } = require('path')
const { once } = require('events')
const { MessageChannel } = require('worker_threads')
const ThreadStream = require('..')

test('worker has default name "thread-stream"', async function (t) {
  const { port1, port2 } = new MessageChannel()
  const stream = new ThreadStream({
    filename: join(__dirname, 'report-thread-name.js'),
    sync: true
  })

  t.after(() => stream.end())

  stream.emit('message', { port: port1 }, [port1])
  const [{ threadName }] = await once(port2, 'message')
  assert.strictEqual(threadName, 'thread-stream')
})

test('worker name can be overridden via workerOpts', async function (t) {
  const { port1, port2 } = new MessageChannel()
  const stream = new ThreadStream({
    filename: join(__dirname, 'report-thread-name.js'),
    workerOpts: {
      name: 'my-custom-worker'
    },
    sync: true
  })

  t.after(() => stream.end())

  stream.emit('message', { port: port1 }, [port1])
  const [{ threadName }] = await once(port2, 'message')
  assert.strictEqual(threadName, 'my-custom-worker')
})

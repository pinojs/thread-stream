'use strict'

/* eslint-disable no-extend-native */
// These tests intentionally pollute Object.prototype to verify thread-stream
// does not inherit those properties. This mirrors CWE-1321 primitives; the
// pollution is always cleaned up in the per-test `t.after()` hook.

const { test } = require('node:test')
const assert = require('node:assert')
const { join } = require('path')
const { once } = require('events')
const { MessageChannel } = require('worker_threads')
const ThreadStream = require('..')

// Regression tests: thread-stream must not inherit prototype-polluted properties
// (Object.prototype.workerOpts / workerData / bufferSize / sync) and flow them
// into the worker, where `env` / `execArgv` are honored.
//
// Each test intentionally pollutes Object.prototype for the duration of the
// test and deletes the polluted key in the cleanup hook.

// threadName was added in Node.js v22.20.0 and v24.6.0
const [major, minor] = process.versions.node.split('.').map(Number)
const supportsThreadName = (major === 22 && minor >= 20) || major >= 24

test('does not inherit a polluted Object.prototype.workerOpts (name)', { skip: !supportsThreadName }, async function (t) {
  const { port1, port2 } = new MessageChannel()
  Object.prototype.workerOpts = { name: 'polluted-worker' }
  t.after(() => { delete Object.prototype.workerOpts })

  const stream = new ThreadStream({
    filename: join(__dirname, 'report-pollution.js'),
    sync: true
  })
  t.after(() => stream.end())

  // The caller does not provide `workerOpts`, so without the defense-in-depth
  // fix the inherited `name` would be applied to the worker.
  stream.emit('message', { port: port1 }, [port1])
  const [{ threadName }] = await once(port2, 'message')
  assert.strictEqual(threadName, 'thread-stream')
})

test('does not inherit a polluted Object.prototype.workerOpts.env into the worker', async function (t) {
  const { port1, port2 } = new MessageChannel()
  Object.prototype.workerOpts = { env: { TS_POLLUTION_SENTINEL: 'poisoned' } }
  t.after(() => { delete Object.prototype.workerOpts })

  const stream = new ThreadStream({
    filename: join(__dirname, 'report-pollution.js'),
    sync: true
  })
  t.after(() => stream.end())

  stream.emit('message', { port: port1 }, [port1])
  const [report] = await once(port2, 'message')
  assert.strictEqual(report.sentinel, null)
})

test('does not inherit a polluted Object.prototype.workerData', async function (t) {
  const { port1, port2 } = new MessageChannel()
  Object.prototype.workerData = { dest: '/tmp/polluted-dest' }
  t.after(() => { delete Object.prototype.workerData })

  const stream = new ThreadStream({
    filename: join(__dirname, 'report-pollution.js'),
    sync: true
  })
  t.after(() => stream.end())

  stream.emit('message', { port: port1 }, [port1])
  const [report] = await once(port2, 'message')
  assert.strictEqual(report.dest, null)
})

test('does not inherit a polluted Object.prototype.bufferSize', async function (t) {
  const { port1, port2 } = new MessageChannel()
  Object.prototype.bufferSize = 0
  t.after(() => { delete Object.prototype.bufferSize })

  // Without the fix, `opts.bufferSize` resolves to the inherited `0` and the
  // constructor throws ("bufferSize must at least fit a 4-byte utf-8 char").
  const stream = new ThreadStream({
    filename: join(__dirname, 'report-pollution.js'),
    sync: true
  })
  t.after(() => stream.end())

  stream.emit('message', { port: port1 }, [port1])
  const [{ threadName }] = await once(port2, 'message')
  assert.strictEqual(threadName, 'thread-stream')
})

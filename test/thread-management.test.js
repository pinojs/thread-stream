'use strict'

const { test } = require('node:test')
const assert = require('node:assert')
const { fork } = require('child_process')
const { join } = require('path')
const { readFile } = require('fs').promises
const { file } = require('./helper')
const { once } = require('events')
const ThreadStream = require('..')

test('exits with 0', async function (t) {
  const dest = file()
  const child = fork(join(__dirname, 'create-and-exit.js'), [dest])

  const [code] = await once(child, 'exit')
  assert.strictEqual(code, 0)

  const data = await readFile(dest, 'utf8')
  assert.strictEqual(data, 'hello world\n')
})

test('flush callback fires after unref on an idle event loop', async function () {
  const dest = file()
  const child = fork(join(__dirname, 'flush-unref-exit.js'), [dest], {
    silent: true
  })

  let stdout = ''
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk) => {
    stdout += chunk
  })

  const [code] = await once(child, 'exit')
  assert.strictEqual(code, 0)
  assert.match(stdout, /CALLBACK/)

  const data = await readFile(dest, 'utf8')
  assert.strictEqual(data, 'hello world\n')
})

test('flush callback does not unref a stream the user has ref\'d', async function () {
  const dest = file()
  const child = fork(join(__dirname, 'flush-ref-keeps-alive.js'), [dest], {
    silent: true
  })

  let stdout = ''
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk) => {
    stdout += chunk
  })

  await new Promise((resolve, reject) => {
    const onExit = (code) => {
      reject(new Error(`child exited ${code} before the flush callback`))
    }
    const onData = () => {
      if (!stdout.includes('CALLBACK')) {
        return
      }
      child.stdout.off('data', onData)
      child.off('exit', onExit)
      resolve()
    }
    child.stdout.on('data', onData)
    child.once('exit', onExit)
  })

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.off('exit', onExit)
      resolve()
    }, 150)
    function onExit (code) {
      clearTimeout(timer)
      reject(new Error(`child exited ${code} after a ref'd flush`))
    }
    child.once('exit', onExit)
  })

  child.kill()
  await once(child, 'exit')
  assert.match(stdout, /CALLBACK/)

  const data = await readFile(dest, 'utf8')
  assert.strictEqual(data, 'hello world\n')
})

test('emit error if thread exits', async function (t) {
  const stream = new ThreadStream({
    filename: join(__dirname, 'exit.js'),
    sync: true
  })

  const closed = once(stream, 'close').catch(() => {})
  // Keep a persistent error listener to avoid unhandled late error events
  // reported as asynchronous activity by stricter test runners.
  stream.on('error', () => {})

  stream.on('ready', () => {
    stream.write('hello world\n')
  })

  let [err] = await once(stream, 'error')
  assert.strictEqual(err.message, 'the worker thread exited')

  stream.write('noop');
  [err] = await once(stream, 'error')
  assert.strictEqual(err.message, 'the worker has exited')

  stream.write('noop');
  [err] = await once(stream, 'error')
  assert.strictEqual(err.message, 'the worker has exited')

  await closed
})

test('emit error if thread have unhandledRejection', async function (t) {
  const stream = new ThreadStream({
    filename: join(__dirname, 'unhandledRejection.js'),
    sync: true
  })

  const closed = once(stream, 'close').catch(() => {})
  // Keep a persistent error listener to avoid unhandled late error events
  // reported as asynchronous activity by stricter test runners.
  stream.on('error', () => {})

  stream.on('ready', () => {
    stream.write('hello world\n')
  })

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

test('emit error if worker stream emit error', async function (t) {
  const stream = new ThreadStream({
    filename: join(__dirname, 'error.js'),
    sync: true
  })

  const closed = once(stream, 'close').catch(() => {})
  // Keep a persistent error listener to avoid unhandled late error events
  // reported as asynchronous activity by stricter test runners.
  stream.on('error', () => {})

  stream.on('ready', () => {
    stream.write('hello world\n')
  })

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

test('emit error if thread have uncaughtException', async function (t) {
  const stream = new ThreadStream({
    filename: join(__dirname, 'uncaughtException.js'),
    sync: true
  })

  const closed = once(stream, 'close').catch(() => {})
  // Keep a persistent error listener to avoid unhandled late error events
  // reported as asynchronous activity by stricter test runners.
  stream.on('error', () => {})

  stream.on('ready', () => {
    stream.write('hello world\n')
  })

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

test('close the work if out of scope on gc', { skip: !global.WeakRef }, async function (t) {
  const dest = file()
  const child = fork(join(__dirname, 'close-on-gc.js'), [dest], {
    execArgv: ['--expose-gc']
  })

  const [code] = await once(child, 'exit')
  assert.strictEqual(code, 0)

  const data = await readFile(dest, 'utf8')
  assert.strictEqual(data, 'hello world\n')
})

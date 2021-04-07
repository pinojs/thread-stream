'use strict'

const { test } = require('tap')
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
  t.equal(code, 0)

  const data = await readFile(dest, 'utf8')
  t.equal(data, 'hello world\n')
})

test('emit error if thread exits', async function (t) {
  const stream = new ThreadStream({
    filename: join(__dirname, 'exit.js'),
    sync: true
  })

  stream.on('ready', function () {
    stream.write('hello world\n')
  })

  const [err] = await once(stream, 'error')
  t.equal(err.message, 'The worker thread exited')

  try {
    stream.write('noop')
    t.fail('unreacheable')
  } catch (err) {
    t.equal(err.message, 'the worker has exited')
  }

  try {
    stream.write('noop')
    t.fail('unreacheable')
  } catch (err) {
    t.equal(err.message, 'the worker has exited')
  }
})

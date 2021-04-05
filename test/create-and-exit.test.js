'use strict'

const { test } = require('tap')
const { fork } = require('child_process')
const { join } = require('path')
const { readFile } = require('fs').promises
const { file } = require('./helper')
const { once } = require('events')

test('exits with 0', async function (t) {
  const dest = file()
  const child = fork(join(__dirname, 'create-and-exit.js'), [dest])

  const [code] = await once(child, 'exit')
  t.equal(code, 0)

  const data = await readFile(dest, 'utf8')
  t.equal(data, 'hello world\n')
})

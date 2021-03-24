'use strict'

const test = require('tape')
const { join } = require('path')
const { tmpdir } = require('os')
const { unlinkSync } = require('fs')
const ThreadStream = require('..')

const files = []
let count = 0

function file () {
  const file = join(tmpdir(), `thread-stream-${process.pid}-${process.hrtime().toString()}-${count++}`)
  files.push(file)
  return file
}

process.on('beforeExit', () => {
  for (const file of files) {
    try {
      unlinkSync(file)
    } catch (e) {
      console.log(e)
    }
  }
})

const MAX = 1000

let str = ''

for (let i = 0; i < 10; i++) {
  str += 'hello'
}

test('base', function (t) {
  const dest = file()
  const stream = new ThreadStream({
    filename: join(__dirname, 'to-file'),
    workerData: { dest }
  })
  let runs = 0
  function benchThreadStream () {
    if (++runs === 1000) {
      process._rawDebug('sending end')
      stream.end()
      return
    }

    for (let i = 0; i < MAX; i++) {
      stream.write(str)
    }
    setImmediate(benchThreadStream)
  }
  benchThreadStream()
  stream.on('finish', function () {
    t.end()
  })
})

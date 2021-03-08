'use strict'

const bench = require('fastbench')
const SonicBoom = require('sonic-boom')
const ThreadStream = require('.')
const Console = require('console').Console
const fs = require('fs')
const { join } = require('path')

const core = fs.createWriteStream('/dev/null')
const fd = fs.openSync('/dev/null', 'w')
const sonic = new SonicBoom({ fd })
const sonicSync = new SonicBoom({ fd, sync: true })
const dummyConsole = new Console(fs.createWriteStream('/dev/null'))
const threadStream = new ThreadStream({
  filename: join(__dirname, 'test', 'to-file'),
  workerdata: { dest: '/dev/null' },
  buffersize: 4 * 1024 * 1024
})
const threadStreamAsync = new ThreadStream({
  filename: join(__dirname, 'test', 'to-file'),
  workerdata: { dest: '/dev/null' },
  buffersize: 4 * 1024 * 1024,
  sync: false
})


const MAX = 10000

let str = ''

for (let i = 0; i < 10; i++) {
  str += 'hello'
}

setTimeout(doBench, 100)

const run = bench([
  function benchThreadStream (cb) {
    for (let i = 0; i < MAX; i++) {
      threadStream.write(str)
    }
    setImmediate(cb)
  },
  function benchThreadStream (cb) {
    threadStreamAsync.once('drain', cb)
    for (let i = 0; i < MAX; i++) {
      threadStreamAsync.write(str)
    }
  },
  function benchSonic (cb) {
    sonic.once('drain', cb)
    for (let i = 0; i < MAX; i++) {
      sonic.write(str)
    }
  },
  function benchSonicSync (cb) {
    sonicSync.once('drain', cb)
    for (let i = 0; i < MAX; i++) {
      sonicSync.write(str)
    }
  },
  function benchCore (cb) {
    core.once('drain', cb)
    for (let i = 0; i < MAX; i++) {
      core.write(str)
    }
  },
  function benchConsole (cb) {
    for (let i = 0; i < MAX; i++) {
      dummyConsole.log(str)
    }
    setImmediate(cb)
  }
], 1000)

function doBench () {
  run(function () {
    run(function () {
      threadStream.end()
    })
  })
}

process.on('beforeExit', function () {
  console.log(threadStream.flushes)
})

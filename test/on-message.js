'use strict'

const { parentPort } = require('node:worker_threads')
const { Writable } = require('node:stream')

function run () {
  parentPort.once('message', function ({ text, takeThisPortPlease }) {
    takeThisPortPlease.postMessage(`received: ${text}`)
  })
  return new Writable({
    autoDestroy: true,
    write (chunk, enc, cb) {
      cb()
    }
  })
}

module.exports = run

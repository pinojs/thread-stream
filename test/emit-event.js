'use strict'

const { Writable } = require('node:stream')
const parentPort = require('node:worker_threads').parentPort

async function run () {
  return new Writable({
    autoDestroy: true,
    write (chunk, enc, cb) {
      if (parentPort) {
        parentPort.postMessage({
          code: 'EVENT',
          name: 'socketError',
          args: ['list', 'of', 'args', 123, new Error('unable to write data to the TCP socket')]
        })
      }
      cb()
    }
  })
}

module.exports = run

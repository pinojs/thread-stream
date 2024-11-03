'use strict'

const { Writable } = require('node:stream')
const parentPort = require('node:worker_threads').parentPort

async function run (opts) {
  return new Writable({
    autoDestroy: true,
    write (chunk, enc, cb) {
      if (parentPort) {
        parentPort.postMessage({
          code: 'EVENT',
          name: 'context',
          args: opts.$context
        })
      }
      cb()
    }
  })
}

module.exports = run

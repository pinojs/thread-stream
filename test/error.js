'use strict'

const { Writable } = require('node:stream')

async function run (opts) {
  const stream = new Writable({
    write (chunk, enc, cb) {
      cb(new Error('kaboom'))
    }
  })
  return stream
}

module.exports = run

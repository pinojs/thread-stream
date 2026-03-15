'use strict'

// This module intentionally has a ReferenceError to test
// that runtime errors are not masked by the require() fallback.
// See https://github.com/pinojs/thread-stream/issues/156

undeclaredVariable.foo() // eslint-disable-line no-undef

const { Writable } = require('stream')

async function run (opts) {
  return new Writable({
    write (chunk, enc, cb) {
      cb()
    }
  })
}

module.exports = run

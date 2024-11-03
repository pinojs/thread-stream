'use strict'

const { PassThrough } = require('node:stream')

async function run (opts) {
  return new PassThrough({})
}

module.exports = run

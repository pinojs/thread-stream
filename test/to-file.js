'use strict'

const fs = require('node:fs')
const { once } = require('node:events')

async function run (opts) {
  const stream = fs.createWriteStream(opts.dest)
  await once(stream, 'open')
  return stream
}

module.exports = run

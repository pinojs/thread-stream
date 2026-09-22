'use strict'

const { join } = require('path')
const ThreadStream = require('../..')

async function run (opts) {
  return new ThreadStream({
    filename: join(__dirname, '..', 'to-file.js'),
    workerData: opts,
    sync: true
  })
}

module.exports = run

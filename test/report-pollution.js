'use strict'

const { Writable } = require('stream')
const { threadName, parentPort } = require('worker_threads')

module.exports = function (opts) {
  parentPort.once('message', function ({ port }) {
    port.postMessage({
      threadName,
      nodeOptions: process.env.NODE_OPTIONS || null,
      execArgv: process.execArgv.slice(),
      sentinel: process.env.TS_POLLUTION_SENTINEL || null,
      dest: opts.dest || null
    })
  })

  return new Writable({
    write (chunk, enc, cb) {
      cb()
    }
  })
}

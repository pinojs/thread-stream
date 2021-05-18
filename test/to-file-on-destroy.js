'use strict'

const fs = require('fs')
const { Writable } = require('stream')

function run (opts) {
  let data = ''
  return new Writable({
    write (chunk, enc, cb) {
      data += chunk.toString()
      cb()
    },
    destroy (err, cb) {
      fs.writeFile(opts.dest, data, function (err2) {
        cb(err2 || err)
      })
    }
  })
}

module.exports = run

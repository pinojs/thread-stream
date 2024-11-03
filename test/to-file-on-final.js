'use strict'

const fs = require('node:fs')
const { Writable } = require('node:stream')

function run (opts) {
  let data = ''
  return new Writable({
    autoDestroy: true,
    write (chunk, enc, cb) {
      data += chunk.toString()
      cb()
    },
    final (cb) {
      setTimeout(function () {
        fs.writeFile(opts.dest, data, function (err) {
          cb(err)
        })
      }, 100)
    }
  })
}

module.exports = run

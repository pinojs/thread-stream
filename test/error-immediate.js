'use strict'

const { EventEmitter } = require('events')

async function run (opts) {
  const dest = new EventEmitter()
  dest.write = function () { return true }
  dest.end = function () { dest.emit('close') }

  setTimeout(() => {
    dest.emit('error', new Error('kaboom'))
  }, 50)

  return dest
}

module.exports = run

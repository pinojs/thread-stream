'use strict'

const { join } = require('path')
const { tmpdir } = require('os')
const { unlinkSync } = require('fs')
const why = require('why-is-node-running')

const files = []
let count = 0

function file () {
  const file = join(tmpdir(), `thread-stream-${process.pid}-${count++}`)
  files.push(file)
  return file
}

process.on('beforeExit', () => {
  console.log('unlink files')
  for (const file of files) {
    try {
      unlinkSync(file)
    } catch (e) {
      console.log(e)
    }
  }
  console.log('unlink completed')
})

module.exports.file = file

setInterval(why, 10000).unref()

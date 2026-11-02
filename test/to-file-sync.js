'use strict'

const fs = require('fs')
const { Writable } = require('stream')

// Writes synchronously, so data is on disk as soon as the worker
// advances the read index. Useful when the process exits right after
// flushSync().
async function run (opts) {
  const fd = fs.openSync(opts.dest, 'w')
  return new Writable({
    autoDestroy: true,
    write (chunk, enc, cb) {
      fs.writeSync(fd, chunk)
      cb()
    },
    destroy (err, cb) {
      fs.close(fd, () => cb(err))
    }
  })
}

module.exports = run

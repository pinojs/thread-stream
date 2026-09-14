'use strict'

const { join } = require('path')
const ThreadStream = require('..')

const stream = new ThreadStream({
  filename: join(__dirname, 'to-file.js'),
  workerData: { dest: process.argv[2] },
  sync: false
})

stream.on('ready', () => {
  stream.ref()
  stream.write('hello world\n')

  stream.flush((err) => {
    if (err) {
      console.error(err)
      process.exit(2)
    }
    process.stdout.write('CALLBACK\n')
  })
})

'use strict'

const test = require('tape')
const { join } = require('path')
const { tmpdir } = require('os')
const { unlinkSync } = require('fs')
const { readFile } = require('fs')
const ThreadStream = require('..')

const files = []
let count = 0

function file () {
  const file = join(tmpdir(), `thread-stream-${process.pid}-${process.hrtime().toString()}-${count++}`)
  files.push(file)
  return file
}

process.on('beforeExit', () => {
  for (const file of files) {
    try {
      unlinkSync(file)
    } catch (e) {
      console.log(e)
    }
  }
})

test('base', function (t) {
  t.plan(7)

  const dest = file()
  const stream = new ThreadStream({
    filename: join(__dirname, 'to-file'),
    workerData: { dest }
  })

  stream.on('drain', () => {
    t.pass('drain')
  })

  stream.on('ready', () => {
    t.pass('ready emitted')
  })

  t.ok(stream.write('hello world\n'))
  t.ok(stream.write('something else\n'))

  stream.end()

  stream.on('finish', () => {
    readFile(dest, 'utf8', (err, data) => {
      t.error(err)
      t.equal(data, 'hello world\nsomething else\n')
    })
  })

  stream.on('close', () => {
    t.pass('close emitted')
  })
})

test('overflow without drain', function (t) {
  t.plan(4)

  const dest = file()
  const stream = new ThreadStream({
    bufferSize: 128,
    filename: join(__dirname, 'to-file'),
    workerData: { dest }
  })

  stream.on('ready', () => {
    t.pass('ready emitted')
    write()
  })

  let count = 0

  // Write 10 chars, 20 times
  function write () {
    if (count++ === 20) {
      stream.end()
      return
    }

    stream.write('aaaaaaaaaa')
    // do not wait for drain event
    setImmediate(write)
  }

  stream.on('finish', () => {
    readFile(dest, 'utf8', (err, data) => {
      t.error(err)
      t.equal(data.length, 200)
    })
  })

  stream.on('close', () => {
    t.pass('close emitted')
  })
})

test('overflow with drain', function (t) {
  const dest = file()
  const stream = new ThreadStream({
    bufferSize: 128,
    filename: join(__dirname, 'to-file'),
    workerData: { dest },
    sync: false
  })

  stream.on('ready', () => {
    t.pass('ready emitted')
    write()
  })

  let count = 0

  // Write 10 chars, 20 times
  function write () {
    if (count++ === 20) {
      stream.end()
      return
    }

    stream.write('aaaaaaaaaa')
    // do not wait for drain event
    setImmediate(write)
  }

  stream.on('drain', () => {
    t.pass('drain')
  })

  stream.on('finish', () => {
    t.pass('finish emitted')
  })

  stream.on('close', () => {
    readFile(dest, 'utf8', (err, data) => {
      t.error(err)
      t.equal(data.length, 200)
      t.end()
    })
  })
})

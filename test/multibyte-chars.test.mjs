import { test } from 'tap'
import { readFile } from 'fs'
import ThreadStream from '../index.js'
import { join } from 'desm'
import { file } from './helper.js'

test('break up utf8 multibyte (sync)', (t) => {
  t.plan(2)
  const longString = '\u03A3'.repeat(16)

  const dest = file()
  const stream = new ThreadStream({
    bufferSize: 15, // this must be odd
    filename: join(import.meta.url, 'to-file.js'),
    workerData: { dest },
    sync: true
  })

  stream.on('ready', function () {
    stream.write(longString)
    stream.end()
  })

  stream.on('finish', () => {
    readFile(dest, 'utf8', (err, data) => {
      t.error(err)
      t.equal(data, longString)
    })
  })
})

test('break up utf8 multibyte (async)', (t) => {
  t.plan(2)
  const longString = '\u03A3'.repeat(16)

  const dest = file()
  const stream = new ThreadStream({
    bufferSize: 15, // this must be odd
    filename: join(import.meta.url, 'to-file.js'),
    workerData: { dest },
    sync: false
  })

  stream.on('ready', function () {
    stream.write(longString)
    stream.end()
  })

  stream.on('finish', () => {
    readFile(dest, 'utf8', (err, data) => {
      t.error(err)
      t.equal(data, longString)
    })
  })
})

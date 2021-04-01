import { test } from 'tap'
import { tmpdir } from 'os'
import { unlinkSync, readFile } from 'fs'
import ThreadStream from '../index.js'
import { join } from 'desm'
import path from 'path'

const files = []
let count = 0

function file () {
  const file = path.join(tmpdir(), `thread-stream-${process.pid}-${process.hrtime().toString()}-${count++}`)
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

test('esm works', function (t) {
  t.plan(7)

  const dest = file()
  const stream = new ThreadStream({
    filename: join(import.meta.url, 'to-file.mjs'),
    workerData: { dest },
    sync: true
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

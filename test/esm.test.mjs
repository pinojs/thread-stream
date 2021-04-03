import { test } from 'tap'
import { tmpdir } from 'os'
import { unlinkSync, readFile } from 'fs'
import ThreadStream from '../index.js'
import { join } from 'desm'
import path from 'path'
import { pathToFileURL } from 'url'

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

function basic (text, filename) {
  test(text, function (t) {
    t.plan(7)

    const dest = file()
    const stream = new ThreadStream({
      filename,
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
}

basic('esm with path', join(import.meta.url, 'to-file.mjs'))
basic('esm with file URL', pathToFileURL(join(import.meta.url, 'to-file.mjs')).href)

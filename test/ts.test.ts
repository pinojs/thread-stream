import { test } from 'tap'
import { readFile } from 'fs'
import ThreadStream from '../index.js'
import { join } from 'path'
import { file } from './helper.js'

function basic (text: string, filename: string): void {
  test(text, function (t) {
    t.plan(5)

    const dest = file()
    const stream = new ThreadStream({
      filename,
      workerData: { dest },
      sync: true
    })

    stream.on('finish', () => {
      readFile(dest, 'utf8', (err, data) => {
        t.error(err)
        t.equal(data, 'hello world\nsomething else\n')
      })
    })

    stream.on('close', () => {
      t.pass('close emitted')
    })

    t.ok(stream.write('hello world\n'))
    t.ok(stream.write('something else\n'))

    stream.end()
  })
}

basic('typescript module', join(__dirname, 'ts', 'to-file.ts'))

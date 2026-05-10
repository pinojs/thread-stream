import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs'
import ThreadStream from '../index.js'
import { join } from 'desm'
import { file } from './helper.js'

test('write heavily interleaved multibyte and ascii payloads hitting boundaries', (t, done) => {
  const dest = file()
  const stream = new ThreadStream({
    bufferSize: 128,
    filename: join(import.meta.url, 'to-file.js'),
    workerData: { dest },
    sync: false
  })

  let expected = ''

  // write 1000 identical items.
  for (let i = 0; i < 1000; i++) {
    const str = '{"idx":' + i + ',"alert":"🚨"}\n'
    expected += str
    stream.write(str)
  }

  stream.on('finish', () => {
    readFile(dest, 'utf8', (err, data) => {
      assert.ifError(err)
      assert.strictEqual(data, expected)
      done()
    })
  })

  stream.end()
})

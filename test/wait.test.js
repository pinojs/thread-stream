'use strict'

const { test } = require('node:test')
const assert = require('node:assert')
const { wait } = require('../lib/wait')

function waitForResult (update) {
  const state = new Int32Array(new SharedArrayBuffer(4))

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('wait did not complete'))
    }, 1000)

    wait(state, 0, 1, Infinity, (err, result) => {
      clearTimeout(timeout)

      if (err) {
        reject(err)
        return
      }

      resolve(result)
    })

    setImmediate(() => {
      update(state)
      Atomics.notify(state, 0)
    })
  })
}

test('wait returns ok when the expected value is reached', async function () {
  const result = await waitForResult((state) => {
    Atomics.store(state, 0, 1)
  })

  assert.strictEqual(result, 'ok')
})

test('wait returns not-equal when the expected value is skipped', async function () {
  const result = await waitForResult((state) => {
    Atomics.store(state, 0, 2)
  })

  assert.strictEqual(result, 'not-equal')
})

test('wait returns not-equal when the value cycles back before notification', async function () {
  const result = await waitForResult((state) => {
    Atomics.store(state, 0, 2)
    Atomics.store(state, 0, 0)
  })

  assert.strictEqual(result, 'not-equal')
})

test('wait returns not-equal for an error sentinel', async function () {
  const result = await waitForResult((state) => {
    Atomics.store(state, 0, -2)
  })

  assert.strictEqual(result, 'not-equal')
})

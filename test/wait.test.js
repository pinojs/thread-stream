'use strict'

const { test } = require('node:test')
const assert = require('node:assert')
const { wait } = require('../lib/wait')

function waitForResult (update, opts = {}) {
  const state = new Int32Array(new SharedArrayBuffer(4))
  const waitTimeout = opts.timeout ?? Infinity

  return new Promise((resolve, reject) => {
    const guard = setTimeout(() => {
      reject(new Error('wait did not complete'))
    }, 1000)

    wait(state, 0, 1, waitTimeout, (err, result) => {
      clearTimeout(guard)

      if (err) {
        reject(err)
        return
      }

      resolve(result)
    })

    setImmediate(() => {
      update(state)
      if (opts.notify !== false) {
        Atomics.notify(state, 0)
      }
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

test('wait detects a value change after the fallback timeout', async function () {
  const result = await waitForResult((state) => {
    Atomics.store(state, 0, 2)
  }, { notify: false, timeout: 10 })

  assert.strictEqual(result, 'not-equal')
})

test('wait returns timed-out when the value does not change', async function () {
  const result = await waitForResult(() => {}, { notify: false, timeout: 10 })

  assert.strictEqual(result, 'timed-out')
})

test('wait handles a synchronous not-equal result', async function () {
  const originalWaitAsync = Atomics.waitAsync
  Atomics.waitAsync = function (state, index, expected, timeout) {
    Atomics.store(state, index, 2)
    return originalWaitAsync(state, index, expected, timeout)
  }

  let result
  try {
    result = await waitForResult(() => {}, { notify: false })
  } finally {
    Atomics.waitAsync = originalWaitAsync
  }

  assert.strictEqual(result, 'not-equal')
})

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

test('wait returns ok when the expected value is overshot', async function () {
  // The reader (READ_INDEX) advances in jumps and may skip over a snapshot of
  // `expected`. Reaching or passing it means the reader has caught up, so this
  // should resolve as ok rather than waiting forever (#250).
  const result = await waitForResult((state) => {
    Atomics.store(state, 0, 2)
  })

  assert.strictEqual(result, 'ok')
})

test('wait returns ok when the value already overshot and will never change again', async function () {
  // This reproduces the #250 hang: READ_INDEX already equals WRITE_INDEX (the
  // worker caught up and is idle), but `expected` is a stale, lower snapshot.
  // With equality-only comparison, wait() arms on a value that never changes
  // again and waits forever. It must instead resolve as soon as the value has
  // reached/passed the target.
  const state = new Int32Array(new SharedArrayBuffer(4))
  Atomics.store(state, 0, 100)

  const result = await new Promise((resolve, reject) => {
    const guard = setTimeout(() => {
      reject(new Error('wait did not complete'))
    }, 500)

    wait(state, 0, 1, Infinity, (err, res) => {
      clearTimeout(guard)

      if (err) {
        reject(err)
        return
      }

      resolve(res)
    })
  })

  assert.strictEqual(result, 'ok')
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

  // The value moved to 2, which >= the expected 1, so the condition is met.
  assert.strictEqual(result, 'ok')
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

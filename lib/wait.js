'use strict'

// Maximum wait time for a single waitAsync call
// Used as a fallback poll interval in case notifications are missed
// Keep this low enough for good throughput but high enough to not busy-loop
const WAIT_MS = 10000

function wait (state, index, expected, timeout, done) {
  const max = timeout === Infinity ? Infinity : Date.now() + timeout

  const check = () => {
    const current = Atomics.load(state, index)
    if (current === expected) {
      done(null, 'ok')
      return
    }

    if (max !== Infinity && Date.now() > max) {
      done(null, 'timed-out')
      return
    }

    // Wait for any change from current value
    const remaining = max === Infinity ? WAIT_MS : Math.min(WAIT_MS, Math.max(1, max - Date.now()))
    const result = Atomics.waitAsync(state, index, current, remaining)

    if (result.async) {
      result.value.then(check)
    } else {
      // Value already changed (not-equal) - recheck on next tick
      setImmediate(check)
    }
  }

  check()
}

function waitDiff (state, index, expected, timeout, done) {
  const max = timeout === Infinity ? Infinity : Date.now() + timeout

  const check = () => {
    const current = Atomics.load(state, index)
    if (current !== expected) {
      done(null, 'ok')
      return
    }

    if (max !== Infinity && Date.now() > max) {
      done(null, 'timed-out')
      return
    }

    // Wait for value to change from expected
    const remaining = max === Infinity ? WAIT_MS : Math.min(WAIT_MS, Math.max(1, max - Date.now()))
    const result = Atomics.waitAsync(state, index, expected, remaining)

    if (result.async) {
      result.value.then(check)
    } else {
      // Value already changed (not-equal) - recheck on next tick
      setImmediate(check)
    }
  }

  check()
}

module.exports = { wait, waitDiff }

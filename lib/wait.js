'use strict'

function wait (state, index, expected, timeout, done) {
  const max = Date.now() + timeout
  let current = Atomics.load(state, index)
  if (current === expected) {
    done(null, 'ok')
    return
  }
  let prior = current
  const check = () => {
    if (Date.now() > max) {
      done(null, 'timed-out')
    } else {
      // Maybe use a backoff algorithm
      setImmediate(() => {
        prior = current
        current = Atomics.load(state, index) 
        if (current === prior) {
          check()
        } else {
          if (current === expected) done(null, 'ok')
          else done(null, 'not-equal')
        }
      })
    }
  }
  check()
}

module.exports = wait

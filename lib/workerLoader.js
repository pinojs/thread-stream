const { isMainThread } = require('worker_threads')

// Only runs when spawned as a Worker
if (!isMainThread) require('./worker.js')

function getWorkerPath () {
  return __filename
}

module.exports = { getWorkerPath }

# thread-stream

A streaming way to send data to a Node.js Worker Thread.

## install

```sh
npm i thread-stream
```

## Usage

```js
'use strict'

const ThreadStream = require('thread-stream')
const { join } = require('path')

const stream = new ThreadStream({
  filename: join(__dirname, 'worker.js'),
  workerData: { dest }
})

stream.write('hello')
stream.write(' ')
stream.write('world')
stream.end()
```

In `worker.js`:

```js
'use strict'

const fs = require('fs')
const { once } = require('events')

async function run (opts) {
  const stream = fs.createWriteStream(opts.dest)
  await once(stream, 'open')
  return stream
}

module.exports = run
```

## License

MIT

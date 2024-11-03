import { type PathLike, type WriteStream, createWriteStream } from 'node:fs'
import { once } from 'node:events'

export default async function run (
  opts: { dest: PathLike },
): Promise<WriteStream> {
  const stream = createWriteStream(opts.dest)
  await once(stream, 'open')
  return stream
}

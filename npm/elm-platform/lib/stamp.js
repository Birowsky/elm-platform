// Which platform last prepared a folder.

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export {
  readStamp,
  writeStamp,
}

function readStamp(dir) {
  const file = toFile(dir)
  return existsSync(file) ? readFileSync(file, 'utf8') : undefined
}

function writeStamp(dir, stamp) {
  writeFileSync(toFile(dir), stamp)
}

function toFile(dir) {
  return join(dir, '.elm-platform-stamp')
}

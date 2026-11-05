// One process at a time in a folder. Builds and test runs start many compilers at once, and only the first may rebuild what they all share.

import { mkdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'

export {
  withLock,
}

const staleAfterMs = 120_000 // a process that died holding the lock must not stop every later one
const retryAfterMs = 50

function withLock(dir, work) {
  const lock = join(dir, '.elm-platform-lock')
  acquire()
  try {
    return work()
  } finally {
    release()
  }

  function acquire() {
    if (tryToAcquire()) return
    if (isStale()) release()
    sleep(retryAfterMs)
    acquire()
  }

  function tryToAcquire() {
    try {
      mkdirSync(lock)
      return true
    } catch (error) {
      if (error.code === 'EEXIST') return false
      throw error
    }
  }

  function isStale() {
    try {
      return Date.now() - statSync(lock).mtimeMs > staleAfterMs
    } catch {
      return false // released in the meantime
    }
  }

  function release() {
    rmSync(lock, { recursive: true, force: true })
  }
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

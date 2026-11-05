// Readies the Elm home: the patched packages in place of the ones Elm would download, and nothing compiled from an older platform.
//
// Elm trusts any package whose `src` folder is in its home, and it keys the compiled `artifacts.dat` of a package on the versions of
// its dependencies, not on its source. So placing a package is enough to use it, and nothing but this notices when one changes.

import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { withLock } from './lock.js'
import { bundledPackages, compilerVersion, elmHome, toStamp } from './platform.js'
import { readStamp, writeStamp } from './stamp.js'

export {
  prepareHome,
}

const shippedEntries = ['src', 'elm.json', 'LICENSE', 'README.md']

function prepareHome() {
  const home = elmHome()
  const stamp = toStamp()
  if (readStamp(home) === stamp) return
  mkdirSync(home, { recursive: true })
  withLock(home, () => {
    if (readStamp(home) === stamp) return // another process did it while this one waited
    forgetCompiledPackages(toCache(home))
    bundledPackages().forEach(pkg => placePackage(toCache(home), pkg))
    writeStamp(home, stamp)
  })
}

function toCache(home) {
  return join(home, compilerVersion, 'packages')
}

function forgetCompiledPackages(cache) {
  toFolders(cache).flatMap(toFolders).flatMap(toFolders).forEach(version => rmSync(join(version, 'artifacts.dat'), { force: true }))

  function toFolders(dir) {
    return existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => join(dir, entry.name)) : []
  }
}

function placePackage(cache, { name, version, dir }) {
  const target = join(cache, name, version)
  rmSync(target, { recursive: true, force: true })
  shippedEntries.forEach(entry => cpSync(join(dir, entry), join(target, entry), { recursive: true }))
}

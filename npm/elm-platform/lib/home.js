// Readies the Elm home, so that the patched packages are where every Elm tool looks for them.
//
// A released package never changes under its version, and no stock project asks for that version, so it is placed once, next to whatever else is in the home.
// A checkout's packages do change under their version, and Elm wouldn't notice: it trusts any `src` folder in its home and keys the compiled `artifacts.dat` of a
// package on the versions of its dependencies, not on its source. So they get a home of their own, replaced whenever their files change.

import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { withLock } from './lock.js'
import { bundledPackages, compilerVersion, elmHome, toStamp, usesCallersHome, usesCheckout } from './platform.js'
import { readStamp, writeStamp } from './stamp.js'

export {
  prepareHome,
}

const shippedEntries = ['src', 'elm.json', 'docs.json', 'LICENSE', 'README.md']

function prepareHome() {
  if (!usesCheckout()) placeReleasedPackages()
  else if (!usesCallersHome()) prepareCheckoutHome() // a caller that names its own home may have linked it to `~/.elm`, which a checkout must stay out of
}

function toCache(home) {
  return join(home, compilerVersion, 'packages')
}

function placeReleasedPackages() {
  bundledPackages().forEach(pkg => placeOnce(toCache(elmHome()), pkg))
}

function placeOnce(cache, { name, version, dir }) {
  const target = join(cache, name, version)
  if (existsSync(join(target, 'elm.json'))) return
  mkdirSync(dirname(target), { recursive: true })
  const incoming = mkdtempSync(join(dirname(target), '.incoming-')) // renamed into place when complete, because a compiler may be reading the home right now
  chmodSync(incoming, 0o755) // a temporary folder starts private, unlike the other packages in the home
  copyPackage(dir, incoming)
  try {
    renameSync(incoming, target)
  } catch (error) {
    rmSync(incoming, { recursive: true, force: true })
    if (!existsSync(target)) throw error // otherwise another process was first
  }
}

function prepareCheckoutHome() {
  const home = elmHome()
  const stamp = toStamp()
  if (readStamp(home) === stamp) return
  mkdirSync(home, { recursive: true })
  withLock(home, () => {
    if (readStamp(home) === stamp) return // another process did it while this one waited
    forgetCompiledPackages(toCache(home))
    bundledPackages().forEach(pkg => replacePackage(toCache(home), pkg))
    writeStamp(home, stamp)
  })
}

function forgetCompiledPackages(cache) {
  toFolders(cache).flatMap(toFolders).flatMap(toFolders).forEach(version => rmSync(join(version, 'artifacts.dat'), { force: true }))

  function toFolders(dir) {
    return existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => join(dir, entry.name)) : []
  }
}

function replacePackage(cache, { name, version, dir }) {
  const target = join(cache, name, version)
  rmSync(target, { recursive: true, force: true })
  copyPackage(dir, target)
}

function copyPackage(from, to) {
  shippedEntries.filter(entry => existsSync(join(from, entry))).forEach(entry => cpSync(join(from, entry), join(to, entry), { recursive: true }))
}

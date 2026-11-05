// What changed in the patched packages since the last release. A released version is placed in the Elm home once and never looked at again, so a change under an old version would reach nobody.

import { execFileSync, spawnSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export {
  bundledPackages,
  root,
  toUnversionedChanges,
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function bundledPackages() {
  const packages = join(root, 'packages')
  return readdirSync(packages).flatMap(author => readdirSync(join(packages, author)).map(name => toPackage(`packages/${author}/${name}`)))

  function toPackage(path) {
    const { name, version } = JSON.parse(readFileSync(join(root, path, 'elm.json'), 'utf8'))
    return { name, version, path }
  }
}

/** The packages that differ from the release before `version` but still have the version they had there. */
function toUnversionedChanges(version) {
  const previous = toPreviousRelease(version)
  return previous ? bundledPackages().filter(pkg => isChanged(pkg, previous) && toVersionIn(previous, pkg) === pkg.version) : []
}

function toPreviousRelease(version) {
  return git('tag', '--list', 'v*', '--merged', 'HEAD', '--sort=-v:refname').split('\n').find(tag => tag !== '' && tag !== `v${version}`)
}

function isChanged({ path }, release) {
  return spawnSync('git', ['diff', '--quiet', release, '--', `${path}/src`, `${path}/elm.json`], { cwd: root }).status !== 0
}

function toVersionIn(release, { path }) {
  return JSON.parse(git('show', `${release}:${path}/elm.json`)).version
}

function git(...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' })
}

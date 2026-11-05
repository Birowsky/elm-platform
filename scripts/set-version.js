// Sets the version of a release: on the main package, on the binary packages, and on the exact pins between them. `node scripts/set-version.js 0.19.3-3`
// A patched package that changed since the last release gets a new version too, which the test apps then pin. Every app has to pin it as well, and the wrapper tells them so.

import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { root, toUnversionedChanges } from './released-packages.js'

const version = process.argv[2]

assertVersion()
readdirSync(join(root, 'npm')).filter(name => name.startsWith('elm-platform')).forEach(setVersion)
toUnversionedChanges(version).forEach(bumpPackage)

function assertVersion() {
  if (!/^\d+\.\d+\.\d+-\d+$/.test(version ?? '')) throw new Error('Give a version like 0.19.3-3: the Elm version and a counter.')
}

function setVersion(name) {
  const file = join(root, 'npm', name, 'package.json')
  const manifest = JSON.parse(readFileSync(file, 'utf8'))
  writeFileSync(file, `${JSON.stringify({ ...manifest, version, ...toPins(manifest) }, null, 2)}\n`)
}

function toPins({ optionalDependencies }) {
  return optionalDependencies ? { optionalDependencies: Object.fromEntries(Object.keys(optionalDependencies).map(name => [name, version])) } : {}
}

function bumpPackage({ name, version: current, path }) {
  const [major, minor, patch] = current.split('.').map(Number)
  const next = `${major}.${minor}.${patch + 1}`
  replaceIn(join(root, path, 'elm.json'), `"version": "${current}"`, `"version": "${next}"`)
  readdirSync(join(root, 'e2e/apps')).forEach(app => replaceIn(join(root, 'e2e/apps', app, 'elm.json'), `"${name}": "${current}"`, `"${name}": "${next}"`))
  console.log(`${name}: ${current} -> ${next}`)
}

function replaceIn(file, from, to) {
  writeFileSync(file, readFileSync(file, 'utf8').replace(from, to))
}

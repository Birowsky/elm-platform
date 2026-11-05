// Sets the version of a release: on the main package, on the binary packages, and on the exact pins between them. `node scripts/set-version.js 0.19.3-3`

import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const version = process.argv[2]

assertVersion()
readdirSync(join(root, 'npm')).filter(name => name.startsWith('elm-platform')).forEach(setVersion)

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

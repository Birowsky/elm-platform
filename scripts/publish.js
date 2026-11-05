// Publishes the release: the binary packages first, because the main package points at them. A package already on the registry is skipped, so a failed release can be run again.

import { execFileSync, spawnSync } from 'node:child_process'
import { chmodSync, existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const main = join(root, 'npm/elm-platform')
const binaryPackages = ['darwin_arm64', 'linux_x64'].map(platform => join(root, `npm/elm-platform-${platform}`))
const { version } = readManifest(main)

assertTagMatchesVersion()
binaryPackages.forEach(assertReady)
binaryPackages.forEach(dir => chmodSync(join(dir, 'elm'), 0o755)) // artifact downloads lose the executable bit
;[...binaryPackages, main].forEach(publish)

function readManifest(dir) {
  return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
}

function assertTagMatchesVersion() {
  const tag = process.env.GITHUB_REF_NAME
  if (tag !== undefined && tag !== `v${version}`) throw new Error(`The tag ${tag} doesn't match the version ${version}.`)
}

function assertReady(dir) {
  const manifest = readManifest(dir)
  if (manifest.version !== version) throw new Error(`${manifest.name} is at ${manifest.version}, not ${version}. Run scripts/set-version.js.`)
  if (!existsSync(join(dir, 'elm'))) throw new Error(`${manifest.name} has no binary at ${join(dir, 'elm')}.`)
}

function publish(dir) {
  const { name } = readManifest(dir)
  if (isPublished(name)) return console.log(`${name}@${version} is already published`)
  execFileSync('npm', ['publish', '--access', 'public', '--tag', 'latest'], { cwd: dir, stdio: 'inherit' }) // `latest` has to be named, because npm asks for a tag on versions like 0.19.3-2
}

function isPublished(name) {
  return spawnSync('npm', ['view', `${name}@${version}`, 'version'], { encoding: 'utf8' }).stdout.trim() === version
}

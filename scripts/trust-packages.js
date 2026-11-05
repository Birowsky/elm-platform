// Sets up npm's trusted publishing, so that .github/workflows/release.yaml publishes without a token. npm only trusts a workflow for a package that exists, so a package new to the registry first gets an empty placeholder version that nothing depends on. Run it yourself, logged in to npm: both steps ask for your 2FA. A trust setting expires if it goes unused for 2 days, so push the release tag right after. `--dry-run` changes nothing.

import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dryRun = process.argv.includes('--dry-run') ? ['--dry-run'] : []
const packages = readdirSync(join(root, 'npm')).filter(name => name.startsWith('elm-platform')).map(toManifest)

packages.filter(({ name }) => !isOnRegistry(name)).forEach(publishPlaceholder)
const untrusted = packages.map(({ name }) => name).filter(name => !trustReleaseWorkflow(name))
reportOutcome()

function toManifest(dir) {
  return JSON.parse(readFileSync(join(root, 'npm', dir, 'package.json'), 'utf8'))
}

function isOnRegistry(name) {
  return spawnSync('npm', ['view', name, 'version'], { stdio: 'ignore' }).status === 0
}

function publishPlaceholder({ name, license, repository }) {
  const dir = mkdtempSync(join(tmpdir(), 'elm-platform-placeholder-'))
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, version: '0.0.0', description: 'An empty placeholder, so that npm can trust the release workflow of this package. Install @birowsky/elm-platform instead.', license, repository }))
  execFileSync('npm', ['publish', '--access', 'public', ...dryRun], { cwd: dir, stdio: 'inherit' })
  rmSync(dir, { recursive: true })
}

function trustReleaseWorkflow(name) {
  return spawnSync('npm', ['trust', 'github', name, '--file', 'release.yaml', '--repository', 'Birowsky/elm-platform', '--allow-publish', '--yes', ...dryRun], { stdio: 'inherit' }).status === 0 // a failure doesn't stop the others: a package that already trusts the workflow fails here on a second run
}

function reportOutcome() {
  console.log(untrusted.length === 0 ? '\nEvery package trusts the release workflow.' : `\nNo trust set on: ${untrusted.join(', ')}. A package that already trusts the workflow lands here too.`)
  process.exitCode = untrusted.length === 0 ? 0 : 1
}

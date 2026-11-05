// Stands in for an app: installs the packed package the way an app would, and compiles the test apps with it, in both modes.
// Testing the tarball, rather than this checkout, is what proves that the release itself works.

import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { browserApps, built, consumer, elmBin, root, scratch, source } from './paths.js'

rmSync(scratch, { recursive: true, force: true })
mkdirSync(consumer, { recursive: true })
const tarball = toTarball()
install(tarball)
browserApps.flatMap(app => ['dev', 'optimize'].map(mode => ({ app, mode }))).forEach(compile)

function toTarball() {
  const name = execFileSync('npm', ['pack', join(root, 'npm/elm-platform'), '--pack-destination', scratch, '--silent'], { encoding: 'utf8', cwd: root }).trim().split('\n').pop()
  return join(scratch, name)
}

function install(tarball) {
  writeFileSync(join(consumer, 'package.json'), JSON.stringify({ private: true }))
  execFileSync('npm', ['install', tarball, 'elm-test@0.19.3-0', '--no-audit', '--no-fund', '--silent'], { cwd: consumer, stdio: 'inherit' })
  cpSync(source('query'), join(consumer, 'query'), { recursive: true })
}

function compile({ app, mode }) {
  const dir = built(app, mode)
  mkdirSync(dir, { recursive: true })
  readdirSync(source(app)).forEach(entry => cpSync(join(source(app), entry), join(dir, entry), { recursive: true }))
  execFileSync(elmBin, ['make', 'src/Main.elm', '--output=main.js', ...(mode === 'optimize' ? ['--optimize'] : [])], { cwd: dir, stdio: 'inherit' })
}

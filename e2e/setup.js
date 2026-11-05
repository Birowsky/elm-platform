// Stands in for an app: installs the packed package the way an app would, and compiles the test apps with it, in both modes.
// Testing the tarball, rather than this checkout, is what proves that the release itself works.

import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { browserApps, built, consumer, elmBin, homeAfterInstall, root, scratch, source } from './paths.js'

rmSync(scratch, { recursive: true, force: true })
mkdirSync(consumer, { recursive: true })
install(['npm/elm-platform', `npm/elm-platform-${process.platform}_${process.arch}`].map(toTarball))
browserApps.flatMap(app => ['dev', 'optimize'].map(mode => ({ app, mode }))).forEach(compile)

function toTarball(dir) {
  const name = execFileSync('npm', ['pack', join(root, dir), '--pack-destination', scratch, '--silent'], { encoding: 'utf8', cwd: root }).trim().split('\n').pop()
  return join(scratch, name)
}

function install(tarballs) {
  writeFileSync(join(consumer, 'package.json'), JSON.stringify({ private: true, allowScripts: { '@birowsky/elm-platform': true } }))
  execFileSync('npm', ['install', ...tarballs, 'elm-test@0.19.3-0', '--no-audit', '--no-fund', '--silent'], { cwd: consumer, stdio: 'inherit', env: { ...process.env, ELM_HOME: homeAfterInstall } })
  cpSync(source('query'), join(consumer, 'query'), { recursive: true })
}

function compile({ app, mode }) {
  const dir = built(app, mode)
  mkdirSync(dir, { recursive: true })
  readdirSync(source(app)).forEach(entry => cpSync(join(source(app), entry), join(dir, entry), { recursive: true }))
  execFileSync(elmBin, ['make', 'src/Main.elm', '--output=main.js', ...(mode === 'optimize' ? ['--optimize'] : [])], { cwd: dir, stdio: 'inherit' })
}

// Writes the docs.json of each patched package, which ships with it. elm-review reads it from the Elm home and otherwise asks the Elm website, which doesn't know these versions.
// `node scripts/build-docs.js`, after changing the API or the doc comments of a package. A test fails until you do.

import { execFileSync } from 'node:child_process'
import { copyFileSync, cpSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { bundledPackages, root } from './released-packages.js'

const elm = join(root, `npm/elm-platform-${process.platform}_${process.arch}/elm`) // `npm run build:compiler` puts it there

bundledPackages().forEach(writeDocs)

function writeDocs({ path }) {
  const dir = join(root, path)
  const scratch = mkdtempSync(join(tmpdir(), 'elm-platform-docs-'))
  const elmHome = mkdtempSync(join(tmpdir(), 'elm-platform-docs-home-')) // never `~/.elm`, which holds the released package of this version
  ;['src', 'elm.json'].forEach(entry => cpSync(join(dir, entry), join(scratch, entry), { recursive: true }))
  execFileSync(elm, ['make', '--docs=docs.json'], { cwd: scratch, env: { ...process.env, ELM_HOME: elmHome }, stdio: 'inherit' })
  copyFileSync(join(scratch, 'docs.json'), join(dir, 'docs.json'))
  ;[scratch, elmHome].forEach(folder => rmSync(folder, { recursive: true, force: true }))
}

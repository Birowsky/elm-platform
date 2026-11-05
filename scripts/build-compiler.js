// Builds compiler/ into its binary package for this machine, which is where the tests, the e2e suite and ELM_PLATFORM_DEV look. Incremental, once cabal has built it once.

import { execFileSync } from 'node:child_process'
import { copyFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const compiler = join(root, 'compiler')
const target = join(root, `npm/elm-platform-${process.platform}_${process.arch}/elm`)

execFileSync('cabal', ['build', 'exe:elm'], { cwd: compiler, stdio: 'inherit' })
copyFileSync(execFileSync('cabal', ['list-bin', 'exe:elm'], { cwd: compiler, encoding: 'utf8' }).trim(), target)
console.log(target)

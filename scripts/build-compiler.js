// Builds compiler/ and links the result to where the wrapper looks when ELM_PLATFORM_DEV points at this checkout. Incremental, once cabal has built it once.

import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, symlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const compiler = join(root, 'compiler')
const link = join(root, '.dev/elm')

execFileSync('cabal', ['build', 'exe:elm'], { cwd: compiler, stdio: 'inherit' })
const binary = execFileSync('cabal', ['list-bin', 'exe:elm'], { cwd: compiler, encoding: 'utf8' }).trim()
mkdirSync(dirname(link), { recursive: true })
rmSync(link, { force: true })
symlinkSync(binary, link)
console.log(`${link} -> ${binary}`)

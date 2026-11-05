// Puts the patched packages into this npm package when it is packed, without their tests.

import { cpSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const source = join(packageDir, '../../packages')
const target = join(packageDir, 'packages')

rmSync(target, { recursive: true, force: true })
cpSync(source, target, { recursive: true, filter: isShipped })

function isShipped(path) {
  return !path.split('/').some(part => part === 'tests' || part === 'node_modules')
}

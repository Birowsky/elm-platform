// The copy only exists for packing: the source of truth is packages/ at the root of the repo.

import { rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

rmSync(join(dirname(fileURLToPath(import.meta.url)), '../packages'), { recursive: true, force: true })

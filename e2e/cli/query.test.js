// elm-test, reaching the installed package the way it does in an app. See apps/query/tests/QueryTest.elm for why.

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { test } from 'node:test'
import { consumer, elmBin } from '../paths.js'

test('elm-test runs against the installed platform and Test.Html reads its nodes', () => {
  const elmTest = join(consumer, 'node_modules/.bin/elm-test')
  const result = spawnSync(elmTest, ['--compiler', elmBin], { cwd: join(consumer, 'query'), encoding: 'utf8' })
  assert.equal(result.status, 0, result.stdout + result.stderr)
})

test('the compiled output comes from the patched package', () => {
  const result = spawnSync(elmBin, ['make', 'src/Views.elm', '--output=/dev/null'], { cwd: join(consumer, 'query'), encoding: 'utf8' })
  assert.equal(result.status, 0, result.stdout + result.stderr) // Views imports VirtualDom.lazyShallowDeep, which stock virtual-dom doesn't have
})

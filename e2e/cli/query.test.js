// elm-test, reaching the installed package the way it does in an app. See apps/query/tests/QueryTest.elm for why.

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { consumer, elmBin, homeAfterInstall, root } from '../paths.js'

const { name, version } = JSON.parse(readFileSync(join(root, 'packages/elm/virtual-dom/elm.json'), 'utf8'))
const placed = join(homeAfterInstall, '0.19.3/packages', name, version)

test('npm install alone places the patched package, with what tools read from it', () => {
  ['elm.json', 'docs.json', 'src/VirtualDom.elm'].forEach(file => assert.ok(existsSync(join(placed, file)), file))
})

test('elm-test runs against the installed platform and Test.Html reads its nodes, on a home nothing but npm install has touched', () => {
  const elmTest = join(consumer, 'node_modules/.bin/elm-test')
  const result = spawnSync(elmTest, ['--compiler', elmBin], { cwd: join(consumer, 'query'), encoding: 'utf8', env: { ...process.env, ELM_HOME: homeAfterInstall } }) // elm-test asks the home for versions before it ever runs elm, and only this release has this one
  assert.equal(result.status, 0, result.stdout + result.stderr)
})

test('the compiled output comes from the patched package', () => {
  const result = spawnSync(elmBin, ['make', 'src/Views.elm', '--output=/dev/null'], { cwd: join(consumer, 'query'), encoding: 'utf8' })
  assert.equal(result.status, 0, result.stdout + result.stderr) // Views imports VirtualDom.lazyShallowDeep, which stock virtual-dom doesn't have
})

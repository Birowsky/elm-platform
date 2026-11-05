// The wrapper, in the layout npm gives an app: a copy of this package under node_modules, the real compiler next to it, and the real packages.

import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'

const packageDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = join(packageDir, '../..')
const binaryPackage = join(repoRoot, `npm/elm-platform-${process.platform}_${process.arch}`) // `npm run build:compiler` fills it
const scratch = mkdtempSync(join(tmpdir(), 'elm-platform-wrapper-'))
const kernel = 'elm/virtual-dom/src/Elm/Kernel/VirtualDom.js'
const patchedVirtualDom = JSON.parse(readFileSync(join(repoRoot, 'packages/elm/virtual-dom/elm.json'), 'utf8')).version
const moduleWithLazy = 'module Main exposing (main)\nimport Html\nimport VirtualDom\nmain = VirtualDom.lazyShallow (\\r -> Html.text r.t) { t = "hi" }\n'
const moduleWithoutLazy = 'module Main exposing (main)\nimport Html\nmain = Html.text "hi"\n'

let warmPackages // a home every test starts from, so that only the first compile goes online

before(() => {
  const app = toApp(toInstall('warm'))
  assertCompiled(run(app))
  warmPackages = toCache(app.install)
})

after(() => rmSync(scratch, { recursive: true, force: true }))

test('places the patched package in ~/.elm, under its own version, where every Elm tool looks', () => {
  const app = toApp(toWarmInstall('normal-home'))
  const result = run(app)
  assertCompiled(result)
  assert.match(toOutput(app), /_VirtualDom_lazyShallow/)
  assert.ok(existsSync(join(toCache(app.install), 'elm/virtual-dom', patchedVirtualDom, 'src/VirtualDom.elm')))
  assert.ok(existsSync(join(toCache(app.install), 'elm/virtual-dom', patchedVirtualDom, 'docs.json')))
  assert.deepEqual(toLeftovers(app.install), [])
})

test('installing places the patched package, for tools that read the home and never run elm', () => {
  const install = toInstall('postinstall')
  const result = spawnSync(process.execPath, [join(toPlatform(install), 'lib/postinstall.js')], { env: toEnv({ install }), encoding: 'utf8' })
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.ok(existsSync(join(toCache(install), 'elm/virtual-dom', patchedVirtualDom, 'elm.json')))
})

test('an install that cannot write to the home still succeeds', () => {
  const install = toInstall('postinstall-no-home')
  writeFileSync(join(install, 'not-a-folder'), '')
  const result = spawnSync(process.execPath, [join(toPlatform(install), 'lib/postinstall.js')], { env: toEnv({ install }, { ELM_HOME: join(install, 'not-a-folder') }), encoding: 'utf8' })
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.match(result.stderr, /could not place its packages/)
})

test('stock and patched versions live side by side in one home', () => {
  const install = toWarmInstall('side-by-side')
  const patched = toApp(install)
  const stock = toApp(install, { pin: '1.0.5', at: 'elm-stuff/generated-code/tool', source: moduleWithoutLazy })
  assertCompiled(run(patched))
  assertCompiled(run(stock))
  assertCompiled(run(patched))
  assert.match(toOutput(patched), /_VirtualDom_lazyShallow/)
  assert.doesNotMatch(toOutput(stock), /_VirtualDom_lazyShallow/)
})

test('elm install picks the patched version, and no version that lacks its source', () => {
  const install = toWarmInstall('elm-install')
  const app = toApp(install, { pin: undefined, source: moduleWithoutLazy })
  writeFileSync(join(app.dir, 'elm.json'), JSON.stringify({ ...toElmJson(undefined), dependencies: { direct: { 'elm/core': '1.0.5' }, indirect: { 'elm/json': '1.1.3' } } }))
  const bare = join(toCache(install), 'elm/virtual-dom/1.950.0')
  mkdirSync(bare, { recursive: true })
  cpSync(join(toPlatform(install), 'packages/elm/virtual-dom/elm.json'), join(bare, 'elm.json')) // what solving leaves behind for every version it looks at
  run(app, {}, ['--version']) // places the patched package, which `elm install` solves against
  const result = spawnSync(process.execPath, [toBin(install), 'install', 'elm/html'], { cwd: app.dir, env: toEnv(app), encoding: 'utf8', input: 'y\n' })
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.equal(JSON.parse(readFileSync(join(app.dir, 'elm.json'), 'utf8')).dependencies.indirect['elm/virtual-dom'], patchedVirtualDom)
})

test('the docs.json of a patched package describes its source: run scripts/build-docs.js if this fails', () => {
  const install = toWarmInstall('docs')
  const dir = join(install, 'package')
  ;['src', 'elm.json'].forEach(entry => cpSync(join(toPlatform(install), 'packages/elm/virtual-dom', entry), join(dir, entry), { recursive: true }))
  const result = spawnSync(process.execPath, [toBin(install), 'make', '--docs=docs.json'], { cwd: dir, env: toEnv({ install }), encoding: 'utf8' })
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.deepEqual(readJson(join(dir, 'docs.json')), readJson(join(repoRoot, 'packages/elm/virtual-dom/docs.json')))
})

test('refuses a project pinned to another version of a patched package', () => {
  const app = toApp(toWarmInstall('wrong-pin'), { pin: '1.0.3' })
  const result = run(app)
  assert.equal(result.status, 1)
  assert.match(result.stderr, /WRONG PACKAGE VERSION/)
  assert.match(result.stderr, new RegExp(`elm/virtual-dom: pinned 1\\.0\\.3, patched ${escapeDots(patchedVirtualDom)}`))
  assert.equal(existsSync(join(app.dir, 'main.js')), false)
})

test('accepts a patched package pinned as an indirect dependency', () => {
  const app = toApp(toWarmInstall('indirect-pin'), { pin: undefined, source: moduleWithoutLazy })
  const result = run(app)
  assertCompiled(result)
})

test('refuses another version of a patched package among the indirect dependencies too', () => {
  const app = toApp(toWarmInstall('wrong-indirect-pin'), { pin: undefined })
  const outline = JSON.parse(readFileSync(join(app.dir, 'elm.json'), 'utf8'))
  writeFileSync(join(app.dir, 'elm.json'), JSON.stringify({ ...outline, dependencies: { ...outline.dependencies, indirect: { ...outline.dependencies.indirect, 'elm/virtual-dom': '1.0.3' } } }))
  const result = run(app)
  assert.equal(result.status, 1)
  assert.match(result.stderr, /WRONG PACKAGE VERSION/)
})

test('lets projects generated inside elm-stuff pin what they like', () => {
  const app = toApp(toWarmInstall('generated'), { pin: '1.0.3', at: 'elm-stuff/generated-code/tool', source: moduleWithoutLazy })
  const result = run(app)
  assertCompiled(result)
})

test('a home named by the caller gets the patched package too, and ~/.elm stays out of it', () => {
  const app = toApp(toWarmInstall('callers-home'))
  const home = join(app.install, 'callers-home')
  rmSync(toCache(app.install), { recursive: true, force: true })
  assertCompiled(run(app, { ELM_HOME: home }))
  assert.match(toOutput(app), /_VirtualDom_lazyShallow/)
  assert.ok(existsSync(join(home, '0.19.3/packages/elm/virtual-dom', patchedVirtualDom, 'elm.json')))
  assert.equal(existsSync(toCache(app.install)), false)
})

test('a new version of a patched package is asked for by name, and used once elm.json pins it', () => {
  const app = toApp(toWarmInstall('new-package-version'))
  assertCompiled(run(app))
  const next = release(app.install, { version: '0.19.3-999', packageVersion: '1.900.999', kernelCode: 'var _Marker_upgrade = 1;' })
  const refused = run(app)
  assert.equal(refused.status, 1)
  assert.match(refused.stderr, new RegExp(`elm/virtual-dom: pinned ${escapeDots(patchedVirtualDom)}, patched ${escapeDots(next)}`))
  writeFileSync(join(app.dir, 'elm.json'), JSON.stringify(toElmJson(next)))
  assertCompiled(run(app))
  assert.match(toOutput(app), /_Marker_upgrade/)
  assert.ok(existsSync(join(toCache(app.install), 'elm/virtual-dom', patchedVirtualDom, 'elm.json'))) // another app may still be on it
})

test('a new release recompiles the project, because its compiler may differ', () => {
  const app = toApp(toWarmInstall('new-release'))
  assertCompiled(run(app))
  const compiled = join(app.dir, 'elm-stuff/0.19.3/Main.elmi')
  assert.ok(existsSync(compiled))
  writeFileSync(join(app.dir, 'elm-stuff/0.19.3/marker'), '')
  release(app.install, { version: '0.19.3-999' })
  assertCompiled(run(app))
  assert.equal(existsSync(join(app.dir, 'elm-stuff/0.19.3/marker')), false)
})

test('a released package is placed once and not looked at again', () => {
  const app = toApp(toWarmInstall('same-release'))
  assertCompiled(run(app))
  appendFileSync(join(toPlatform(app.install), 'packages', kernel), 'var _Marker_ignored = 1;\n')
  assertCompiled(run(app))
  assert.doesNotMatch(toOutput(app), /_Marker_ignored/)
})

test('with ELM_PLATFORM_DEV, an edit in the checkout counts on the next compile, and stays out of ~/.elm', () => {
  const app = toApp(toWarmInstall('dev'))
  assertCompiled(run(app))
  const checkout = join(app.install, 'checkout')
  cpSync(join(toPlatform(app.install), 'packages'), join(checkout, 'packages'), { recursive: true })
  const env = { ELM_PLATFORM_DEV: checkout }
  assertCompiled(run(app, env))
  assert.doesNotMatch(toOutput(app), /_Marker_dev/)
  appendFileSync(join(checkout, 'packages', kernel), 'var _Marker_dev = 1;\n')
  assertCompiled(run(app, env))
  assert.match(toOutput(app), /_Marker_dev/)
  assertCompiled(run(app))
  assert.doesNotMatch(toOutput(app), /_Marker_dev/) // back on the released package
})

test('compilers that start together all succeed', async () => {
  const install = toInstall('together')
  seedWarmPackages(install)
  const apps = ['a', 'b', 'c', 'd'].map(name => toApp(install, { at: name }))
  const codes = await Promise.all(apps.map(runAsync))
  assert.deepEqual(codes, [0, 0, 0, 0])
  apps.forEach(app => assert.match(toOutput(app), /_VirtualDom_lazyShallow/))
})

test('passes on what the compiler exits with', () => {
  const app = toApp(toWarmInstall('exit-code'))
  assert.notEqual(spawnSync(process.execPath, [toBin(app.install), 'make', 'src/Missing.elm', '--output=x.js'], { cwd: app.dir, env: toEnv(app) }).status, 0)
  assert.equal(spawnSync(process.execPath, [toBin(app.install), '--version'], { cwd: app.dir, env: toEnv(app), encoding: 'utf8' }).stdout.trim(), '0.19.3')
})

test('an empty d.dat costs a rebuild, not a hang', () => { // a compile stopped halfway leaves these files empty, and Elm kept reading past their end forever
  assertCompiled(runWithEmptyCacheFile('d.dat'))
})

;['i.dat', 'o.dat'].forEach(file => {
  test(`an empty ${file} is reported, not a hang`, () => {
    const result = runWithEmptyCacheFile(file)
    assert.equal(result.status, 1, result.stdout + result.stderr)
    assert.match(result.stderr, /CORRUPT CACHE/)
  })
})

test('platformInputs names what decides compiled output', async () => {
  const app = toApp(toWarmInstall('inputs'))
  const checkout = join(app.install, 'checkout')
  cpSync(join(app.install, 'node_modules/@birowsky/elm-platform/packages'), join(checkout, 'packages'), { recursive: true })
  const lib = join(app.install, 'node_modules/@birowsky/elm-platform/lib/index.js')
  const script = `const { platformInputs } = await import(${JSON.stringify(lib)}); console.log(JSON.stringify(platformInputs()))`
  const toInputs = env => JSON.parse(spawnSync(process.execPath, ['--input-type=module', '-e', script], { env: { ...toEnv(app), ...env }, encoding: 'utf8' }).stdout)
  assert.deepEqual(toInputs({}).map(file => file.split('/').pop()), ['package.json'])
  assert.ok(toInputs({ ELM_PLATFORM_DEV: checkout }).some(file => file.endsWith('src/Elm/Kernel/VirtualDom.js')))
})


function assertCompiled(result) {
  assert.equal(result.status, 0, result.stdout + result.stderr)
}

function toInstall(name) {
  const install = join(scratch, name)
  const platform = join(install, 'node_modules/@birowsky/elm-platform')
  mkdirSync(join(install, 'user-home'), { recursive: true })
  ;['bin', 'lib', 'package.json'].forEach(entry => cpSync(join(packageDir, entry), join(platform, entry), { recursive: true }))
  cpSync(join(repoRoot, 'packages'), join(platform, 'packages'), { recursive: true, filter: path => !path.split('/').some(part => part === 'tests' || part === 'node_modules') })
  symlinkSync(binaryPackage, join(install, `node_modules/@birowsky/${basename(binaryPackage)}`))
  return install
}

function toWarmInstall(name) {
  const install = toInstall(name)
  seedWarmPackages(install)
  return install
}

function seedWarmPackages(install) {
  cpSync(warmPackages, toCache(install), { recursive: true, filter: path => !path.endsWith('artifacts.dat') && !path.endsWith(`elm/virtual-dom/${patchedVirtualDom}`) }) // each install places its own patched package
}

function release(install, { version, packageVersion, kernelCode }) {
  const platform = toPlatform(install)
  writeFileSync(join(platform, 'package.json'), JSON.stringify({ ...readJson(join(platform, 'package.json')), version }))
  if (packageVersion === undefined) return undefined
  const outline = join(platform, 'packages/elm/virtual-dom/elm.json')
  writeFileSync(outline, JSON.stringify({ ...readJson(outline), version: packageVersion }))
  appendFileSync(join(platform, 'packages', kernel), `${kernelCode}\n`)
  return packageVersion
}

function toPlatform(install) {
  return join(install, 'node_modules/@birowsky/elm-platform')
}

function toCache(install) {
  return join(install, 'user-home/.elm/0.19.3/packages')
}

function toLeftovers(install) {
  return readdirSync(join(toCache(install), 'elm/virtual-dom')).filter(entry => entry.startsWith('.incoming'))
}

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'))
}

function escapeDots(version) {
  return version.replaceAll('.', '\\.')
}

function toApp(install, { pin = patchedVirtualDom, at = 'app', source = moduleWithLazy } = {}) {
  const dir = join(install, at)
  mkdirSync(join(dir, 'src'), { recursive: true })
  writeFileSync(join(dir, 'src/Main.elm'), source)
  writeFileSync(join(dir, 'elm.json'), JSON.stringify(toElmJson(pin)))
  return { install, dir }
}

function toElmJson(pin) {
  return {
    type: 'application',
    'source-directories': ['src'],
    'elm-version': '0.19.3',
    dependencies: {
      direct: { 'elm/core': '1.0.5', 'elm/html': '1.0.0', ...(pin === undefined ? {} : { 'elm/virtual-dom': pin }) },
      indirect: { 'elm/json': '1.1.3', ...(pin === undefined ? { 'elm/virtual-dom': patchedVirtualDom } : {}) },
    },
    'test-dependencies': { direct: {}, indirect: {} },
  }
}

function toBin(install) {
  return join(install, 'node_modules/@birowsky/elm-platform/bin/elm.js')
}

function toEnv(app, extra = {}) {
  const { ELM_HOME, ELM_PLATFORM_DEV, ...rest } = process.env
  return { ...rest, HOME: join(app.install, 'user-home'), ...extra }
}

function run(app, extraEnv, args = ['make', 'src/Main.elm', '--output=main.js']) {
  return spawnSync(process.execPath, [toBin(app.install), ...args], { cwd: app.dir, env: toEnv(app, extraEnv), encoding: 'utf8' })
}

function runWithEmptyCacheFile(file) {
  const app = toApp(toWarmInstall(`empty-${file}`))
  assertCompiled(run(app))
  writeFileSync(join(app.dir, 'elm-stuff/0.19.3', file), '')
  return spawnSync(process.execPath, [toBin(app.install), 'make', 'src/Main.elm', '--output=main.js'], { cwd: app.dir, env: toEnv(app), encoding: 'utf8', timeout: 30_000 }) // a hang comes back as status null
}

function runAsync(app) {
  return new Promise(resolve => {
    spawn(process.execPath, [toBin(app.install), 'make', 'src/Main.elm', '--output=main.js'], { cwd: app.dir, env: toEnv(app), stdio: 'ignore' }).on('exit', resolve)
  })
}

function toOutput(app) {
  return readFileSync(join(app.dir, 'main.js'), 'utf8')
}

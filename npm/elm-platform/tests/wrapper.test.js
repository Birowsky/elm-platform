// The wrapper, in the layout npm gives an app: a copy of this package under node_modules, the real compiler next to it, and the real packages.

import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
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
const moduleWithLazy = 'module Main exposing (main)\nimport Html\nimport VirtualDom\nmain = VirtualDom.lazyShallow (\\r -> Html.text r.t) { lazyDummy = (), t = "hi" }\n'

let warmPackages // a home every test starts from, so that only the first compile goes online

before(() => {
  const app = toApp(toInstall('warm'))
  assert.equal(run(app).status, 0)
  warmPackages = join(app.install, 'node_modules/.cache/elm-platform/home/0.19.3/packages')
})

after(() => rmSync(scratch, { recursive: true, force: true }))

test('puts the patched package in its own home and leaves ~/.elm alone', () => {
  const app = toApp(toWarmInstall('own-home'))
  const result = run(app)
  assert.equal(result.status, 0, result.stderr)
  assert.match(toOutput(app), /_VirtualDom_lazyShallow/)
  assert.equal(existsSync(join(app.install, 'user-home/.elm')), false)
})

test('refuses a project pinned to another version of a patched package', () => {
  const app = toApp(toWarmInstall('wrong-pin'), { pin: '1.0.3' })
  const result = run(app)
  assert.equal(result.status, 1)
  assert.match(result.stderr, /WRONG PACKAGE VERSION/)
  assert.match(result.stderr, new RegExp(`elm/virtual-dom: pinned 1\\.0\\.3, patched ${patchedVirtualDom.replaceAll('.', '\\.')}`))
  assert.equal(existsSync(join(app.dir, 'main.js')), false)
})

test('accepts a patched package pinned as an indirect dependency', () => {
  const app = toApp(toWarmInstall('indirect-pin'), { pin: undefined, source: 'module Main exposing (main)\nimport Html\nmain = Html.text "hi"\n' })
  const result = run(app)
  assert.equal(result.status, 0, result.stderr)
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
  const app = toApp(toWarmInstall('generated'), { pin: '1.0.3', at: 'elm-stuff/generated-code/tool', source: 'module Main exposing (main)\nimport Html\nmain = Html.text "hi"\n' })
  const result = run(app)
  assert.equal(result.status, 0, result.stderr)
})

test('a home named by the caller is used as it is', () => {
  const app = toApp(toWarmInstall('callers-home'))
  const home = join(app.install, 'callers-home')
  mkdirSync(join(home, '0.19.3/packages'), { recursive: true })
  const result = run(app, { ELM_HOME: home })
  assert.equal(result.status, 1) // the stock package has no lazyShallow: compiling against it fails
  assert.match(result.stdout + result.stderr, /lazyShallow/)
  assert.equal(existsSync(join(home, '.elm-platform-stamp')), false)
  assert.equal(readFileSync(join(home, '0.19.3/packages', kernel.replace('elm/virtual-dom', `elm/virtual-dom/${patchedVirtualDom}`)), 'utf8').includes('elm_lazy_deep'), false)
})

test('a new release replaces the packages and everything compiled from them', () => {
  const app = toApp(toWarmInstall('upgrade'))
  assert.equal(run(app).status, 0)
  release(app.install, '0.19.3-999', 'var _Marker_upgrade = 1;')
  const result = run(app)
  assert.equal(result.status, 0, result.stderr)
  assert.match(toOutput(app), /_Marker_upgrade/)
})

test('the same release does not recompile anything', () => {
  const app = toApp(toWarmInstall('same-release'))
  assert.equal(run(app).status, 0)
  appendFileSync(join(app.install, 'node_modules/@birowsky/elm-platform/packages', kernel), 'var _Marker_ignored = 1;\n') // a released package does not change, so nothing looks
  assert.equal(run(app).status, 0)
  assert.doesNotMatch(toOutput(app), /_Marker_ignored/)
})

test('with ELM_PLATFORM_DEV, an edit in the checkout counts on the next compile', () => {
  const app = toApp(toWarmInstall('dev'))
  const checkout = join(app.install, 'checkout')
  cpSync(join(app.install, 'node_modules/@birowsky/elm-platform/packages'), join(checkout, 'packages'), { recursive: true })
  const env = { ELM_PLATFORM_DEV: checkout }
  assert.equal(run(app, env).status, 0)
  assert.doesNotMatch(toOutput(app), /_Marker_dev/)
  appendFileSync(join(checkout, 'packages', kernel), 'var _Marker_dev = 1;\n')
  const result = run(app, env)
  assert.equal(result.status, 0, result.stderr)
  assert.match(toOutput(app), /_Marker_dev/)
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
  const packages = join(install, 'node_modules/.cache/elm-platform/home/0.19.3/packages')
  cpSync(warmPackages, packages, { recursive: true, filter: path => !path.endsWith('artifacts.dat') })
}

function release(install, version, kernelCode) {
  const platform = join(install, 'node_modules/@birowsky/elm-platform')
  const manifest = JSON.parse(readFileSync(join(platform, 'package.json'), 'utf8'))
  writeFileSync(join(platform, 'package.json'), JSON.stringify({ ...manifest, version }))
  appendFileSync(join(platform, 'packages', kernel), `${kernelCode}\n`)
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

function run(app, extraEnv) {
  return spawnSync(process.execPath, [toBin(app.install), 'make', 'src/Main.elm', '--output=main.js'], { cwd: app.dir, env: toEnv(app, extraEnv), encoding: 'utf8' })
}

function runAsync(app) {
  return new Promise(resolve => {
    spawn(process.execPath, [toBin(app.install), 'make', 'src/Main.elm', '--output=main.js'], { cwd: app.dir, env: toEnv(app), stdio: 'ignore' }).on('exit', resolve)
  })
}

function toOutput(app) {
  return readFileSync(join(app.dir, 'main.js'), 'utf8')
}

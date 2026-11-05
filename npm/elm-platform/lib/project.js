// Readies an Elm project: refuses pins that would silently miss a patch, and drops what an older platform compiled.

import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join, sep } from 'node:path'
import { withLock } from './lock.js'
import { bundledPackages, compilerVersion, toStamp, version } from './platform.js'
import { readStamp, writeStamp } from './stamp.js'

export {
  findProject,
  prepareProject,
}

/** The folder Elm itself would settle on: the nearest one up with an elm.json. */
function findProject(dir) {
  if (existsSync(join(dir, 'elm.json'))) return dir
  return dirname(dir) === dir ? undefined : findProject(dirname(dir))
}

function prepareProject(root) {
  assertPinsMatch(root)
  refreshCompiledOutput(root)
}

/** Without this, a project on another version of a patched package gets the stock code, with no error anywhere. */
function assertPinsMatch(root) {
  const mismatches = isGenerated(root) ? [] : toMismatches(toPins(root))
  if (mismatches.length === 0) return
  console.error(toMessage(mismatches))
  process.exit(1)

  function isGenerated(root) { // elm-review and elm-test build their own projects inside elm-stuff, with pins that aren't the app's to change
    return root.split(sep).includes('elm-stuff')
  }

  function toMismatches(pins) {
    return bundledPackages()
      .filter(({ name, version }) => pins[name] !== undefined && pins[name] !== version)
      .map(({ name, version }) => ({ name, patched: version, pinned: pins[name] }))
  }

  function toMessage(mismatches) {
    return [
      `-- WRONG PACKAGE VERSION ${'-'.repeat(47)} elm.json`,
      '',
      `@birowsky/elm-platform ${version} patches these packages, but your elm.json pins other versions, which would run without the patches:`,
      '',
      ...mismatches.map(({ name, patched, pinned }) => `    ${name}: pinned ${pinned}, patched ${patched}`),
      '',
      'Change elm.json to the patched versions.',
      '',
    ].join('\n')
  }
}

function toPins(root) {
  const { dependencies, 'test-dependencies': testDependencies } = readOutline(root)
  return { ...dependencies?.direct, ...dependencies?.indirect, ...testDependencies?.direct, ...testDependencies?.indirect }

  function readOutline(root) {
    try {
      return JSON.parse(readFileSync(join(root, 'elm.json'), 'utf8'))
    } catch {
      return {} // Elm reports a broken elm.json better than this could
    }
  }
}

function refreshCompiledOutput(root) {
  const stuff = join(root, 'elm-stuff')
  const stamp = toStamp()
  if (readStamp(stuff) === stamp) return
  mkdirSync(stuff, { recursive: true })
  withLock(stuff, () => {
    if (readStamp(stuff) === stamp) return // another process did it while this one waited
    rmSync(join(stuff, compilerVersion), { recursive: true, force: true })
    writeStamp(stuff, stamp)
  })
}

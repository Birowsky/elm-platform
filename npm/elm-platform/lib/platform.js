// What this install of the platform is: its version, its compiler, its patched packages and where it keeps them.

import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

export {
  bundledPackages,
  compilerVersion,
  elmHome,
  platformInputs,
  toBinary,
  toStamp,
  usesCallersHome,
  usesCheckout,
  version,
}

const packageDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const { version } = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'))
const compilerVersion = version.replace(/-.*$/, '') // the npm version 0.19.3-1 carries Elm 0.19.3
const devRoot = process.env.ELM_PLATFORM_DEV ? resolve(process.env.ELM_PLATFORM_DEV) : undefined // a checkout of this repo, to try changes without releasing them
const packagesDir = join(devRoot ?? packageDir, 'packages')

function usesCallersHome() {
  return process.env.ELM_HOME !== undefined
}

function usesCheckout() {
  return devRoot !== undefined
}

/** Where every Elm tool looks, since a patched package has a version of its own that no stock project asks for. A checkout's packages are unreleased, so they stay out of it. */
function elmHome() {
  return process.env.ELM_HOME ?? (devRoot ? join(toNodeModules(), '.cache/elm-platform/checkout-home') : join(homedir(), '.elm'))

  function toNodeModules() {
    const parts = packageDir.split(sep)
    const index = parts.lastIndexOf('node_modules')
    return index === -1 ? join(packageDir, 'node_modules') : parts.slice(0, index + 1).join(sep)
  }
}

function toBinary() {
  const binaryPackage = `elm-platform-${process.platform}_${process.arch}`
  const local = devRoot && join(devRoot, 'npm', binaryPackage, 'elm') // `npm run build:compiler` puts it there
  return local && existsSync(local) ? local : toPublishedBinary()

  function toPublishedBinary() {
    try {
      return createRequire(import.meta.url).resolve(`@birowsky/${binaryPackage}/elm`)
    } catch {
      throw new Error(`@birowsky/elm-platform has no compiler for ${process.platform} on ${process.arch}: @birowsky/${binaryPackage} is not installed. It ships for macOS on arm64 and Linux on x64.`)
    }
  }
}

function bundledPackages() {
  return existsSync(packagesDir) ? toDirectories(packagesDir).flatMap(toDirectories).map(toBundledPackage) : []

  function toDirectories(dir) {
    return readdirSync(dir, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => join(dir, entry.name))
  }

  function toBundledPackage(dir) {
    const { name, version } = JSON.parse(readFileSync(join(dir, 'elm.json'), 'utf8'))
    return { name, version, dir }
  }
}

/** Changes whenever compiled output could: every cache made under another stamp is stale. */
function toStamp() {
  return devRoot ? `dev:${toDevHash()}` : `release:${version}`

  function toDevHash() {
    const hash = createHash('sha256')
    toPackageFiles().forEach(file => hash.update(file).update(readFileSync(file)))
    const { size, mtimeMs } = statSync(toBinary()) // reading the binary on every compile would cost more than the rest of this file together
    return hash.update(`${toBinary()}:${size}:${mtimeMs}`).digest('hex')
  }
}

/** The files that decide what the compiler produces, for tools that cache its output, like webpack. */
function platformInputs() {
  return devRoot ? [...toPackageFiles(), toBinary()] : [join(packageDir, 'package.json')]
}

function toPackageFiles() {
  return bundledPackages().flatMap(({ dir }) => [join(dir, 'elm.json'), ...toFilesIn(join(dir, 'src'))])

  function toFilesIn(dir) {
    return readdirSync(dir, { recursive: true }).map(file => join(dir, file)).filter(path => statSync(path).isFile()).sort()
  }
}

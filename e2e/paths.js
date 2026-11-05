import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export {
  browserApps,
  built,
  consumer,
  elmBin,
  homeAfterInstall,
  root,
  scratch,
  source,
}

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const scratch = join(here, '.tmp')
const consumer = join(scratch, 'consumer')
const elmBin = join(consumer, 'node_modules/.bin/elm')
const homeAfterInstall = join(scratch, 'home-after-install') // only `npm install` ever touches this one, to prove what tools find that never run `elm` themselves
const browserApps = ['lazy']

process.env.ELM_HOME = join(scratch, 'home') // never `~/.elm`: a package placed there is never replaced, so a later run with a changed package under the same version would test the old one

function source(app) {
  return join(here, 'apps', app)
}

function built(app, mode) {
  return join(consumer, 'built', `${app}-${mode}`)
}

import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export {
  browserApps,
  built,
  consumer,
  elmBin,
  root,
  scratch,
  source,
}

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const scratch = join(here, '.tmp')
const consumer = join(scratch, 'consumer')
const elmBin = join(consumer, 'node_modules/.bin/elm')
const browserApps = ['lazy']

function source(app) {
  return join(here, 'apps', app)
}

function built(app, mode) {
  return join(consumer, 'built', `${app}-${mode}`)
}

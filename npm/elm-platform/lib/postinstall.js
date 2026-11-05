// Places the patched packages when the platform is installed, because elm-test, elm-review and editors read the Elm home without ever running `elm`.
// Nothing here may fail an install: `elm` places them too, on its first run.

import { prepareHome } from './home.js'

try {
  prepareHome()
} catch (error) {
  console.warn(`@birowsky/elm-platform could not place its packages in the Elm home: ${error.message}. The elm command will try again.`)
}

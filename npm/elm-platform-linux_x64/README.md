# @birowsky/elm-platform-linux_x64

The Elm compiler binary for Linux on x64, built from `compiler/` in [elm-platform](https://github.com/Birowsky/elm-platform). You don't install this yourself: [`@birowsky/elm-platform`](https://www.npmjs.com/package/@birowsky/elm-platform) depends on it.

It is **unofficial**, and not affiliated with or endorsed by the Elm project or Evan Czaplicki. The Elm compiler is BSD-3-Clause, see `LICENSE`. The binary also contains the GHC runtime and libraries it was built with.

This one is statically linked, so it also contains musl (MIT), GMP (LGPL-3.0 or GPL-2.0), zlib (zlib) and ncurses (MIT-style). The recipe is `compiler/installers/linux/Dockerfile`.

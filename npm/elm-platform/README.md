# @birowsky/elm-platform

An **unofficial** Elm distribution: the Elm compiler plus patched core libraries, released as one tested version. It is not affiliated with or endorsed by the Elm project or Evan Czaplicki.

```bash
npm install --save-dev --save-exact @birowsky/elm-platform
```

This gives you the `elm` command. elm-test, elm-review and webpack loaders find it the way they find the stock one.

## What is patched

| Package | Version | Change |
|---|---|---|
| `elm/virtual-dom` | 1.0.5 | `Html.Keyed` moves as few kids as possible, so the ones that stay keep focus, scroll position and animations |
| `elm/virtual-dom` | 1.0.5 | Adds `VirtualDom.lazyShallow` and `VirtualDom.lazyFancy` |
| compiler | 0.19.3 | `elm diff` and `elm bump` report compatible changes apart from breaking ones, and tell same-named types from different modules apart |
| compiler | 0.19.3 | A project's first compile no longer fails now and then with `elm-stuff/0.19.3/d.dat: resource busy (file is locked)` |

The compiler ships for macOS on arm64 and Linux on x64.

Your `elm.json` has to pin the versions in this table. `elm` stops with an error if it pins another one, because that project would run the stock code without saying so. Patched packages keep the version number they patch, because Elm only accepts versions that are published.

## Where things go

Patched packages can't share `~/.elm` with projects that expect the stock code, so the Elm home lives at `node_modules/.cache/elm-platform/home`. If you set `ELM_HOME` yourself, that home is used as it is and no patches are placed in it.

For tools that cache compiler output or need the home:

```js
import { elmHome, platformInputs, version } from '@birowsky/elm-platform'
```

`platformInputs()` lists the files that decide what the compiler produces. A cache that doesn't depend on them serves stale output after an upgrade.

## License

BSD-3-Clause, like the Elm compiler and the packages it patches. See `LICENSE`.

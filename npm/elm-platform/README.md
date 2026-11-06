# @birowsky/elm-platform

An **unofficial** Elm distribution: the Elm compiler plus patched core libraries, released as one tested version. It is not affiliated with or endorsed by the Elm project or Evan Czaplicki.

```bash
npm install --save-dev --save-exact @birowsky/elm-platform
```

This gives you the `elm` command. elm-test, elm-review and webpack loaders find it the way they find the stock one.

## What is patched

| Package | Version | Change |
|---|---|---|
| `elm/virtual-dom` | 1.900.4 | `Html.Keyed` moves as few kids as possible, so the ones that stay keep focus, scroll position and animations |
| `elm/virtual-dom` | 1.900.4 | Adds `VirtualDom.lazyShallow` and `VirtualDom.lazyShallowDeep` |
| `elm/virtual-dom` | 1.900.4 | Adds `VirtualDom.keyedLayers`: keyed kids that leave with a CSS transition, turn around if they come back before it ends, and take their direction from a `transition-order` number |
| `elm/virtual-dom` | 1.900.4 | A keyed node with the attribute `ef-stagger` staggers the kids added to it later, the ones in view and a few more, with delays spread by an easing its CSS declares, over at most `--stagger-span` and a `--stagger-step` per gap |
| `elm/virtual-dom` | 1.900.4 | A view or a moved keyed kid that is lazy and gets a new root element no longer leaves the old element behind |
| compiler | 0.19.3 | `elm diff` and `elm bump` report compatible changes apart from breaking ones, and tell same-named types from different modules apart |
| compiler | 0.19.3 | A project's first compile no longer fails now and then with `elm-stuff/0.19.3/d.dat: resource busy (file is locked)` |
| compiler | 0.19.3 | A cache file left empty by an interrupted compile no longer makes `elm` spin forever at full CPU |
| compiler | 0.19.3 | A package version in the Elm home counts as known even when the Elm website doesn't list it, which is what lets patched packages have versions of their own |

The compiler ships for macOS on arm64 and Linux on x64.

Your `elm.json` has to pin the versions in this table, and `elm` stops with an error if it pins another one, because that project would run without the patches. `elm init` and `elm install` pick them on their own. A project pinning one only builds with this compiler: stock Elm answers `INCOMPATIBLE DEPENDENCIES`.

## Where things go

In the normal Elm home: `~/.elm`, or `ELM_HOME` if you set it. Patched packages have versions of their own that no stock project asks for, so they sit there safely next to the stock ones, and other projects on the machine notice nothing. That is also where elm-test, elm-review and editor plugins look, so they all find them with no setup.

Those tools look before they ever run `elm`, so a `postinstall` script places the package when it is installed. npm 11 runs it and warns that `allowScripts` doesn't cover it, which this silences, in your root `package.json`:

```json
"allowScripts": { "@birowsky/elm-platform": true }
```

If your install skips scripts, `elm` places the package on its first run, and elm-test fails with `no version of elm/virtual-dom` until then.

For tools that cache compiler output or need the home:

```js
import { elmHome, platformInputs, version } from '@birowsky/elm-platform'
```

`platformInputs()` lists the files that decide what the compiler produces. A cache that doesn't depend on them serves stale output after an upgrade.

## License

BSD-3-Clause, like the Elm compiler and the packages it patches. See `LICENSE`.

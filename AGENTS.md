# AGENTS.md

The Elm compiler and patched core libraries, released to apps as one npm package, `@birowsky/elm-platform`. One version number covers the compiler and the libraries, because that combination is what the e2e tests ran.

## Layout

- `compiler/`: elm/compiler as a git subtree, Haskell, GHC 9.10.3 and cabal 3.16.1.0.
- `packages/<author>/<name>/`: each patched Elm package as a git subtree, with its tests in `tests/`.
- `npm/elm-platform/`: the main npm package. `bin/elm.js` is what apps run as `elm`. Not a workspace, because its optional dependencies are the binary packages of a release that isn't published yet.
- `npm/elm-platform-<platform>/`: one package per platform, holding the compiler binary, which git ignores.
- `e2e/`: stands in for an app: packs and installs the package, compiles `apps/*` with it, runs them in Chromium and WebKit.

## Commands

| What | Command |
|---|---|
| Install | `npm ci` |
| Build the compiler into its binary package, which the tests below use | `npm run build:compiler` |
| Kernel and wrapper tests | `npm test` |
| E2E | `npm run e2e` (first: `npx playwright install chromium webkit`) |
| Set a release's version on every package, and on each patched package that changed | `node scripts/set-version.js 0.19.3-N` |
| Write the `docs.json` of each patched package | `node scripts/build-docs.js` |
| Build and test every platform without publishing | `gh workflow run release.yaml` |
| Compiler tests | `cd compiler && cabal test` |
| Try a checkout in an app, unreleased | `ELM_PLATFORM_DEV=<this repo> npm run serve:web -w frontend`, from the app |

## Rules the code can't show

- **A patched package has a version of its own: `<major>.900.N`.** `1.900.0` is what no stock project can ask for, since the Elm website will never list it, and it stays inside the `< 2.0.0` that the packages depending on it allow. Our compiler counts the versions in the Elm home as known (`withLocalVersions` in `Deps/Registry.hs`), which stock Elm doesn't, so a project pinning one fails on stock Elm with `INCOMPATIBLE DEPENDENCIES`. Apps have to pin the version a release ships, and the wrapper stops the build if they don't.
- **Never change what a released version holds.** The wrapper places a version in the Elm home once and doesn't look at it again, which is what lets `~/.elm` be shared. `scripts/set-version.js` gives a changed package the next `N`, and `scripts/publish.js` refuses a changed package under an old version.
- **The package has to be in the Elm home before any tool asks for it.** elm-test and the editor plugins look there without running `elm`, and elm-test fails with `no version of elm/virtual-dom in 1.900.0` otherwise. So the package is placed at install (`lib/postinstall.js`, which an app allows through `allowScripts`) as well as by `elm` itself. elm-review reads `docs.json` from the same folder and otherwise asks the Elm website, so it ships with the package, and a test fails when it doesn't match the source.
- **Never let a kernel field change its letter.** The compiler numbers kernel fields (the `__name` tokens, comments included) by first appearance in the file, and `elm-explorations/test` hard-codes the resulting letters for virtual-dom. So don't introduce a `__field` early in `VirtualDom.js`, and use a plain property like `elm_lazy_deep` for anything new on a node. `tests/field-letters.test.js` and `e2e/apps/query` catch this.
- **No new node types.** Render, patching and `elm-explorations/test` all switch on the node type. Build on the existing ones.
- **Keep patches as separate commits on top of upstream**, one change each, with their tests. Git history is the list of how we differ, and each commit can go upstream as a PR.
- **Elm notices nothing about a changed package.** `artifacts.dat` is keyed on dependency versions and `elm-stuff` on the mtime of `elm.json`. The wrapper drops a project's `elm-stuff` when its stamp changes (`lib/project.js`): the release, or with `ELM_PLATFORM_DEV` a hash of the files. A checkout's packages change under one version, so they get a home of their own, with the same treatment (`lib/home.js`), and never touch `~/.elm`.
- **`~/.elm` is shared with stock Elm, so its compiled files have to stay interchangeable.** Today they are: a stock compile in a home our compiler wrote to gives the same bytes as in a home only stock has seen. A compiler change that alters generated code or the format of `artifacts.dat` has to rename that file in the same commit (`Elm/Details.hs`), so that the two compilers stop reading each other's, and packages compiled before the change get rebuilt. The byte comparison under Releasing is how you find out.

## Tests

A change to a kernel gets a test beside it, on the real kernel in jsdom, and when it depends on the compiler or a browser, one in `e2e/`. A skipped view leaves no trace in the DOM, so `e2e/apps/lazy` shows how to observe one: views read a JavaScript object that the test changes behind Elm's back.

## Upstream

Pull: `git subtree pull --prefix=compiler https://github.com/elm/compiler.git main`, or the same for a package. Send a patch upstream: `git format-patch -1 <commit> --relative=compiler`, then apply it in a clone of the upstream repo.

To patch another package, add it as a subtree at the version apps use, `git subtree add --prefix=packages/elm/<name> https://github.com/elm/<name>.git <tag>`, set its version to `<major>.900.0`, run `node scripts/build-docs.js`, and list it in `npm/elm-platform/README.md`.

## Releasing

1. `node scripts/set-version.js 0.19.3-N`: the Elm version plus a counter, the same on every npm package. It also moves each patched package that changed since the last release to its next version, and says which.
2. Update the table in `npm/elm-platform/README.md`.
3. Commit, tag `v0.19.3-N`, push both. `.github/workflows/release.yaml` builds what changed, runs the tests on every platform and publishes, through npm's trusted publishing. There is no token, no npm login and no one to ask, so an agent releases this way too. Re-running a failed publish job skips what is already on npm.
4. Wait for the version: npm can take about 15 minutes after the job ends, and `npm view` answers 404 until then.
5. In each app, set the exact version, and in its `elm.json` any patched version that moved. Its own CI is the last check, and reverting those lines is the rollback.

A package new to npm, such as one for a new platform, can't be published by the workflow until the owner of the npm account has run `node scripts/trust-packages.js` for it, with their 2FA. Tag within 2 days of that, because npm expires a trust setting that goes unused.

Before publishing a compiler change that shouldn't affect generated code, compile a real app with it and with the previous binary, from clean caches, and compare the bytes.

## Code style

Answer the reader's questions in order: exports right under the imports, then what the module does as a column of one-liners, then the definitions below their use. Declare functions with `function`, never as a `const`. A definition nests when one place uses it. Comments about a line go on it, trailing. Name for the domain, not the mechanism. No imperative loops unless they buy a noticeable speed gain. The wrapper has no dependencies, so that installing it stays cheap; kernel code follows the style of the file it is in.

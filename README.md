# elm-platform

The Elm compiler and patched core libraries, released to apps as one tested version: [`@birowsky/elm-platform`](npm/elm-platform/README.md). It exists so that fixes and features can ship on our schedule. It is **unofficial**, and not affiliated with or endorsed by the Elm project or Evan Czaplicki.

```
compiler/                  elm/compiler, as a git subtree
packages/elm/virtual-dom/  elm/virtual-dom, as a git subtree
npm/elm-platform/          the npm package: the `elm` wrapper
e2e/                       test apps compiled with the packed package and run in real browsers
```

Each patch is its own commit on top of upstream, so `git log -- packages/elm/virtual-dom` lists how we differ.

```bash
npm ci
npm test       # kernel tests, wrapper tests
npm run e2e    # needs: npx playwright install chromium webkit
```

See [AGENTS.md](AGENTS.md) for how to change things and how to release.

## License

BSD-3-Clause, like everything it is built from. `compiler/LICENSE` and each package's `LICENSE` keep their upstream notices.

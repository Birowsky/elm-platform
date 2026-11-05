#!/usr/bin/env bash
# Builds the Elm compiler natively on macOS. Run from the repo root: ./build-mac.sh
set -euo pipefail
cd "$(dirname "$0")"

GHC_VERSION=9.10.3      # matches installers/linux/Dockerfile (upstream build)
CABAL_VERSION=3.16.1.0  # matches installers/linux/Dockerfile

[ "$(uname -s)" = "Darwin" ] || { echo "This script is for macOS."; exit 1; }
ARCH=$(uname -m)
echo "==> macOS $ARCH"

# Toolchain via ghcup (official installer; Xcode command line tools required).
xcode-select -p >/dev/null 2>&1 || { echo "Run: xcode-select --install"; exit 1; }
if ! command -v ghcup >/dev/null && [ ! -x "$HOME/.ghcup/bin/ghcup" ]; then
  export BOOTSTRAP_HASKELL_NONINTERACTIVE=1 BOOTSTRAP_HASKELL_MINIMAL=1 BOOTSTRAP_HASKELL_ADJUST_BASHRC=0
  curl --proto '=https' --tlsv1.2 -sSf https://get-ghcup.haskell.org | sh
fi
export PATH="$HOME/.ghcup/bin:$PATH"
ghcup install ghc "$GHC_VERSION" --set
ghcup install cabal "$CABAL_VERSION" --set

echo "==> $(ghc --version) / cabal $(cabal --version | head -1)"
cabal update
cabal build exe:elm
BIN=$(cabal list-bin exe:elm)
echo "==> Built: $BIN"
"$BIN" --version

#!/usr/bin/env bash
# Build the OpenSchema tree-sitter parser and install it (plus the highlight
# queries) into your Neovim runtime so `*.schema` / `*.openschema` files light
# up. Re-run this whenever the grammar or queries change.
#
# Usage: editor/nvim/install.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
GRAMMAR_DIR="$REPO_ROOT/tree-sitter-openschema"
NVIM_CONFIG="${XDG_CONFIG_HOME:-$HOME/.config}/nvim"
PARSER_DIR="$NVIM_CONFIG/parser"
QUERY_DIR="$NVIM_CONFIG/queries/openschema"

if ! command -v tree-sitter >/dev/null 2>&1; then
  echo "error: the tree-sitter CLI is not on your PATH." >&2
  echo "install it with: cargo install tree-sitter-cli   (or: npm i -g tree-sitter-cli)" >&2
  exit 1
fi

echo "Generating and building the parser…"
cd "$GRAMMAR_DIR"
tree-sitter generate
tree-sitter build -o openschema.so

echo "Installing into $NVIM_CONFIG…"
mkdir -p "$PARSER_DIR" "$QUERY_DIR"
cp openschema.so "$PARSER_DIR/openschema.so"
cp queries/highlights.scm "$QUERY_DIR/highlights.scm"
cp queries/folds.scm "$QUERY_DIR/folds.scm"

echo "Done."
echo "Next: add editor/nvim/openschema.lua to your Neovim config (see docs/editor-support.md)."

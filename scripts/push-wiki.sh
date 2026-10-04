#!/usr/bin/env bash
# Publish docs/wiki/ to the GitHub wiki (github.com/adithyakumarcr/kural/wiki).
# The wiki is its own git repository (kural.wiki.git); docs/wiki/ is where its pages are written and reviewed, in
# pull requests like the code. Run this after such a pull request is merged.
# (GitHub creates the wiki repository only after its first page exists: if the push fails with "not found", open the
# Wiki tab on GitHub once, save any page, then run this again.)
set -euo pipefail
cd "$(dirname "$0")/.."
REPO="${WIKI_REPO:-https://github.com/adithyakumarcr/kural.wiki.git}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
git clone -q "$REPO" "$TMP/wiki" || git init -q "$TMP/wiki"
find "$TMP/wiki" -maxdepth 1 -name '*.md' -delete
cp docs/wiki/*.md "$TMP/wiki/"
cd "$TMP/wiki"
git add -A
if git diff --cached --quiet; then echo "The wiki is already up to date."; exit 0; fi
git commit -q -m "Update the wiki from docs/wiki ($(git -C "$OLDPWD" rev-parse --short HEAD))"
git push -q "$REPO" HEAD:master
echo "Wiki updated: https://github.com/adithyakumarcr/kural/wiki"

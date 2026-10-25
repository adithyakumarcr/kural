#!/usr/bin/env bash
# fetch.sh [--dry-run] [--pristine] [dest]: VS Code's source, ready to build, in dest (default build/vscode-src).
#   1. VS Code at exactly vscode_commit (vscode.lock), 2. VSCodium's repository at vscodium_tag,
#   3. Kural's patches (patches/kural/*.patch, made against pristine VS Code, so first),
#   4. VSCodium's changes the way its prepare_vscode.sh makes a stable build (read at that tag, not run),
#   5. product.json "kuralSource", 6. a stamp: an unchanged lock + patches + script do nothing the next time.
# --dry-run prints the steps and touches nothing. --pristine only does step 1 (default build/vscode-pristine):
# the tree to make a new patch in (see patches/kural/README.md).
# Also runs under Git Bash on Windows (the Windows build, KURAL_SOURCE=1 ./build-win.sh): both checkouts are made with LF line
# ends (core.autocrlf false, core.eol lf: VS Code's .gitattributes has `* text=auto`, which would give CRLF there and no patch
# would apply) and long paths on.
set -euo pipefail
cd "$(dirname "$0")/../.."
. scripts/vscode/lock.sh
# python3 on Windows is python (actions/setup-python has no python3; the Microsoft Store's python3 is a stub that fails)
python3 -c '' >/dev/null 2>&1 || python3() { python "$@"; }

DRY=0 PRISTINE=0 DEST=""
for a in "$@"; do
  case "$a" in
    --dry-run) DRY=1 ;;
    --pristine) PRISTINE=1 ;;
    -h|--help) sed -n 2,11p "$0"; exit 0 ;;
    -*) echo "Unknown option: $a (try --help)" >&2; exit 1 ;;
    *) DEST="$a" ;;
  esac
done
[ -n "$DEST" ] || { [ "$PRISTINE" = 1 ] && DEST=build/vscode-pristine || DEST=build/vscode-src; }
VSCODIUM_DIR="${VSCODIUM_DIR:-build/vscodium-src}"
# Which of VSCodium's per-system patch folders (patches/osx, patches/linux, patches/windows) to use.
case "$(uname -s)" in Darwin) OS_NAME=osx ;; Linux) OS_NAME=linux ;; *) OS_NAME=windows ;; esac
OS_NAME="${KURAL_OS:-$OS_NAME}"

COMMIT="$(lock_get vscode_commit)" VERSION="$(lock_get vscode_version)" TAG="$(lock_get vscodium_tag)"
[[ "$COMMIT" =~ ^[0-9a-f]{40}$ ]] || { echo "vscode.lock: vscode_commit is not a 40-character sha" >&2; exit 1; }
STAMP="$DEST/.kural-source-stamp"
START=$(date +%s)

say() { echo "$*"; }
die() { echo "Error: $*" >&2; exit 1; }
hash() { if command -v sha256sum >/dev/null 2>&1; then sha256sum | awk '{print $1}'; else shasum -a 256 | awk '{print $1}'; fi; }

kural_patches=(); shopt -s nullglob
for p in patches/kural/*.patch; do kural_patches+=("$p"); done
shopt -u nullglob

# What the result depends on. Same text = nothing to do.
want_stamp() {
  { cat vscode.lock scripts/vscode/fetch.sh; echo "os=$OS_NAME"
    for p in ${kural_patches[@]+"${kural_patches[@]}"}; do echo "$p"; cat "$p"; done; } | hash
}

# A folder we may reset/clean must be its own git repository, never a folder inside Kural's.
own_repo() {   # own_repo <dir>: true when <dir> is the top of its own git repository
  local top; top="$(git -C "$1" rev-parse --show-toplevel 2>/dev/null)" || return 1
  # Git for Windows says C:/a/b, Git Bash's pwd says /c/a/b: compare the same spelling
  if command -v cygpath >/dev/null 2>&1; then top="$(cygpath -u "$top")"; fi
  [ -d "$1/.git" ] && [ "$top" = "$(cd "$1" && pwd -P)" ]
}

step1() {
  say "1. VS Code $VERSION at $COMMIT -> $DEST"
  [ "$DRY" = 1 ] && return 0
  mkdir -p "$DEST"
  if [ ! -d "$DEST/.git" ]; then
    [ -z "$(ls -A "$DEST")" ] || die "$DEST exists and is not a git checkout made by this script; move it away"
    git init -q "$DEST"
    git -C "$DEST" remote add origin https://github.com/microsoft/vscode.git
  fi
  # Same text as upstream on Windows too: no CRLF conversion (autocrlf is on in Git for Windows' default), and paths over 260 characters.
  git -C "$DEST" config core.autocrlf false
  git -C "$DEST" config core.eol lf
  git -C "$DEST" config core.longpaths true
  # The source has no LFS files; a global git-lfs filter without the program installed would break the checkout.
  git -C "$DEST" config filter.lfs.required false
  git -C "$DEST" config filter.lfs.process ""
  git -C "$DEST" config filter.lfs.smudge ""
  git -C "$DEST" config filter.lfs.clean ""
  own_repo "$DEST" || die "$DEST is not its own git repository; move it away"
  if [ "$(git -C "$DEST" rev-parse -q --verify HEAD 2>/dev/null || true)" != "$COMMIT" ]; then
    git -C "$DEST" fetch --depth 1 origin "$COMMIT"
    git -C "$DEST" -c advice.detachedHead=false checkout -q --force FETCH_HEAD
  fi
  # Back to the pristine commit. Ignored files (node_modules, out-build) stay: a patch change doesn't cost a new npm ci.
  git -C "$DEST" reset -q --hard "$COMMIT"
  git -C "$DEST" clean -fdq
}

step2() {
  say "2. VSCodium $TAG -> $VSCODIUM_DIR"
  [ "$DRY" = 1 ] && return 0
  if [ -d "$VSCODIUM_DIR/.git" ]; then
    own_repo "$VSCODIUM_DIR" || die "$VSCODIUM_DIR is not its own git repository; move it away"
    if [ "$(git -C "$VSCODIUM_DIR" describe --tags --exact-match 2>/dev/null || true)" = "$TAG" ]; then
      git -C "$VSCODIUM_DIR" reset -q --hard && return 0
    fi
    rm -rf "$VSCODIUM_DIR"
  fi
  mkdir -p "$(dirname "$VSCODIUM_DIR")"
  git -c advice.detachedHead=false -c core.autocrlf=false -c core.eol=lf -c core.longpaths=true \
    clone -q --depth 1 --branch "$TAG" https://github.com/VSCodium/vscodium "$VSCODIUM_DIR"
}

step3() {
  say "3. Kural's patches (${#kural_patches[@]}), on pristine VS Code, in name order"
  for p in ${kural_patches[@]+"${kural_patches[@]}"}; do
    say "   kural patch: $(basename "$p" .patch)"
    [ "$DRY" = 1 ] && continue
    # a checkout of Kural's own repository with autocrlf (Git for Windows' default) has CRLF here: git apply would refuse every hunk
    if LC_ALL=C grep -q $'\r' "$p"; then
      die "$(basename "$p") has CRLF line ends: check Kural out with core.autocrlf false (git config --global core.autocrlf false), then again"
    fi
    git -C "$DEST" apply --whitespace=nowarn "$PWD/$p" 2>&1 \
      || die "Kural patch $(basename "$p") does not apply to VS Code $COMMIT"
  done
}

# VSCodium's own placeholders in its patches, for a stable "VSCodium" build.
subst() {   # subst <patch> <out>
  sed -e "s|!!APP_NAME!!|VSCodium|g" -e "s|!!APP_NAME_LC!!|vscodium|g" -e "s|!!ASSETS_REPOSITORY!!|VSCodium/vscodium|g" \
      -e "s|!!BINARY_NAME!!|codium|g" -e "s|!!GH_REPO_PATH!!|VSCodium/vscodium|g" -e "s|!!GLOBAL_DIRNAME!!|vscodium|g" \
      -e "s|!!ORG_NAME!!|VSCodium|g" -e "s|!!RELEASE_VERSION!!|$TAG|g" -e "s|!!TUNNEL_APP_NAME!!|codium-tunnel|g" "$1" > "$2"
}

# prepare_vscode.sh, the stable build, without the parts for installers (deb/rpm, Windows' Inno Setup and MSI: Kural makes its own
# .deb and NSIS installer; so no build/win32/code.iss edits and no LICENSE.rtf either, they only feed those installers).
# The Windows product.json values (win32AppUserModelId, win32DirName, ... the app and mutex ids) are among the setpath lines.
# The product.json lines are read from its text at this tag (its `setpath` calls, not the "insider" branches), so they follow the tag.
vscodium_product() {   # vscodium_product <vscode dir> <vscodium dir>
  python3 -I - "$1" "$2" <<'PYEOF'
import json, re, sys
src, codium = sys.argv[1], sys.argv[2]
text = open(f"{codium}/prepare_vscode.sh", encoding="utf-8").read()
section = text.split("# {{{ product.json", 1)[1].split("# }}}", 1)[0]
product = json.load(open(f"{src}/product.json", encoding="utf-8"))
def put(path, value):
    node = product
    parts = path.split(".")
    for k in parts[:-1]: node = node.setdefault(k, {})
    node[parts[-1]] = value
depth, insider, n = 0, {}, 0
call = re.compile(r"""^\s*setpath(_json)? "product" "([^"]+)" (?:"([^"]*)"|'(.*)')\s*$""")
for line in section.splitlines():
    s = line.strip()
    if s.startswith("if [[") and "insider" in s: depth += 1; insider[depth] = 1; continue
    if s == "else" and depth and insider[depth] == 1: insider[depth] = 2; continue
    if s == "fi" and depth: depth -= 1; continue
    if depth and insider[depth] == 1: continue          # the insider branch
    m = call.match(line)
    if m:
        put(m.group(2), json.loads(m.group(4)) if m.group(1) else m.group(3)); n += 1
if n < 40 or product.get("nameShort") != "VSCodium":
    sys.exit(f"read only {n} setpath lines from VSCodium's prepare_vscode.sh: did its layout change?")
extra = json.load(open(f"{codium}/product.json", encoding="utf-8"))   # `jq -s '.[0] * .[1]'`: objects merge, the rest replaced
def merge(a, b):
    for k, v in b.items():
        a[k] = merge(a[k], v) if isinstance(a.get(k), dict) and isinstance(v, dict) else v
    return a
merge(product, extra)
with open(f"{src}/product.json", "w", encoding="utf-8") as f:
    json.dump(product, f, indent=2, ensure_ascii=False); f.write("\n")
print(f"   product.json: {n} VSCodium values + its product.json merged")
PYEOF
}

# `[{"action":"remove","paths":[...]}]` files in VSCodium's patches folder (a missing path is an error, as there).
vscodium_actions() {   # vscodium_actions <vscode dir> <json file>
  python3 -I - "$1" "$2" <<'PYEOF'
import json, os, shutil, sys
src, f = sys.argv[1], sys.argv[2]
for entry in json.load(open(f, encoding="utf-8")):
    if entry.get("action") != "remove": continue
    for p in entry["paths"]:
        t = os.path.join(src, p.rstrip("\r"))
        if not os.path.lexists(t): sys.exit(f"{os.path.basename(f)}: not found: {p}")
        shutil.rmtree(t) if os.path.isdir(t) and not os.path.islink(t) else os.remove(t)
PYEOF
}

# The small text edits prepare_vscode.sh makes outside patches (it runs them after npm ci; nothing there needs node_modules).
vscodium_texts() {   # vscodium_texts <vscode dir> <vscodium dir>
  python3 -I - "$1" "$2" "$TAG" <<'PYEOF'
import json, os, re, sys
src, codium, tag = sys.argv[1:4]
def edit(rel, fn):
    p = os.path.join(src, rel)
    if not os.path.exists(p): print(f"   warning: {rel} not found"); return
    old = open(p, encoding="utf-8").read(); new = fn(old)
    if new != old: open(p, "w", encoding="utf-8").write(new)
lines = lambda rx, to: lambda t: "".join(re.sub(rx, to, l, count=1) for l in t.splitlines(True))
edit("package.json", lambda t: lines(r"Microsoft Corporation", "VSCodium")(
    re.sub(r'("version"\s*:\s*)"[^"]*"', lambda m: f'{m.group(1)}"{tag}"', t, count=1)))
edit("resources/server/manifest.json", lambda t: t.replace('"Visual Studio Code', '"VSCodium'))
edit("build/lib/electron.ts", lambda t: lines(r"([0-9]) Microsoft", r"\1 VSCodium")(lines(r"Microsoft Corporation", "VSCodium")(t)))
ann = open(f"{codium}/announcements-builtin.json", encoding="utf-8").read().replace("\n", "")
edit("src/vs/workbench/contrib/welcomeGettingStarted/browser/gettingStarted.ts", lambda t: t.replace("[/* BUILTIN_ANNOUNCEMENTS */]", ann))
PYEOF
}

step4() {
  say "4. VSCodium's changes ($OS_NAME), as prepare_vscode.sh does for a stable build"
  say "   overlay src/stable, product.json, patches/*.json, patches/*.patch, patches/$OS_NAME/*.patch, patches/user/*.patch"
  if [ "$DRY" = 1 ]; then
    [ -d "$VSCODIUM_DIR/patches" ] && for p in "$VSCODIUM_DIR"/patches/*.patch "$VSCODIUM_DIR/patches/$OS_NAME/"*.patch; do
      [ -f "$p" ] && say "   vscodium patch: $(basename "$p" .patch)"
    done
    return 0
  fi
  cp -Rp "$VSCODIUM_DIR/src/stable/." "$DEST/"
  cp -f "$VSCODIUM_DIR/LICENSE" "$DEST/LICENSE.txt"
  vscodium_product "$DEST" "$VSCODIUM_DIR"
  vscodium_texts "$DEST" "$VSCODIUM_DIR"
  local f tmp; tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' RETURN
  for f in "$VSCODIUM_DIR"/patches/*.json; do [ -f "$f" ] && { say "   vscodium actions: $(basename "$f")"; vscodium_actions "$DEST" "$f"; }; done
  for f in "$VSCODIUM_DIR"/patches/*.patch "$VSCODIUM_DIR/patches/$OS_NAME/"*.patch "$VSCODIUM_DIR"/patches/user/*.patch; do
    [ -f "$f" ] || continue
    say "   vscodium patch: $(basename "$f" .patch)"
    subst "$f" "$tmp/p.patch"
    git -C "$DEST" apply --ignore-whitespace --whitespace=nowarn "$tmp/p.patch" 2>&1 || die "VSCodium patch $(basename "$f") does not apply (after Kural's patches?)"
  done
}

step5() {
  say "5. product.json kuralSource: commit and ${#kural_patches[@]} patch name(s)"
  [ "$DRY" = 1 ] && return 0
  local names=""
  for p in ${kural_patches[@]+"${kural_patches[@]}"}; do names="$names$(basename "$p" .patch)
"; done
  python3 -I - "$DEST/product.json" "$COMMIT" "$names" <<'PYEOF'
import json, sys
f, commit, names = sys.argv[1:4]
p = json.load(open(f, encoding="utf-8"))
p["kuralSource"] = {"commit": commit, "patches": [n for n in names.split("\n") if n]}
with open(f, "w", encoding="utf-8") as o: json.dump(p, o, indent=2, ensure_ascii=False); o.write("\n")
PYEOF
}

step6() {
  say "6. stamp $STAMP"
  [ "$DRY" = 1 ] && return 0
  want_stamp > "$STAMP"
}

if [ "$PRISTINE" = 1 ]; then
  step1
  [ "$DRY" = 1 ] && { say "(dry run: nothing was changed)"; exit 0; }
  say "Pristine VS Code $VERSION in $DEST: edit there, then: git diff > patches/kural/NNNN-name.patch"
  exit 0
fi

if [ -f "$STAMP" ] && [ "$(cat "$STAMP")" = "$(want_stamp)" ]; then
  say "$DEST is up to date (same vscode.lock, Kural patches and fetch.sh)."
  [ "$DRY" = 1 ] || exit 0
  say "(dry run: the steps below would not run)"
fi
[ "$DRY" = 1 ] || rm -f "$STAMP"
step1; step2; step3; step4; step5; step6
[ "$DRY" = 1 ] && { say "(dry run: nothing was changed)"; exit 0; }
say "Done in $(( $(date +%s) - START )) s: $DEST ($(du -sh "$DEST" | awk '{print $1}'))"

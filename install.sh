#!/usr/bin/env bash
# Build Kural from this code and install it on this computer: a Mac (Apple Silicon) or Ubuntu / Debian.
#
#   ./install.sh            build everything and install it (on a Mac it then opens Kural)
#   ./install.sh --ext      only put your changes in extension/ into the installed Kural (a few seconds)
#   ./install.sh --no-open  don't open Kural afterwards (Mac)
#   ./install.sh --fresh    install like on a new computer: your Kural settings, chats and extensions are moved to a
#                           backup folder first (Claude Code and Ollama are separate programs: not touched)
#
# The first full build downloads VSCodium once (~250 MB, kept in downloads/). Later builds take about a minute.
# Windows is built on Linux: ./build-win.sh
set -euo pipefail
cd "$(dirname "$0")"

MODE=full OPEN=1 FRESH=0
for a in "$@"; do
  case "$a" in
    --ext) MODE=ext ;;
    --no-open) OPEN=0 ;;
    --fresh) FRESH=1 ;;
    -h|--help) sed -n 2,10p "$0"; exit 0 ;;
    *) echo "Unknown option: $a (try --help)"; exit 1 ;;
  esac
done
die() { echo "Error: $*" >&2; exit 1; }
[ "$FRESH" = 1 ] && [ "$MODE" = ext ] && die "--fresh is for a full install, not with --ext."

# --fresh: Kural keeps your settings, chats and extensions outside the app, so a normal install (an update) keeps
# them. For a first-time install, move them out of the way (not deleted: put them back to undo).
fresh_start() {   # fresh_start <folder or file>...
  local backup="$HOME/kural-backup-$(date +%Y%m%d-%H%M%S)" moved=0
  for p in "$@"; do
    [ -e "$p" ] || continue
    mkdir -p "$backup"
    mv "$p" "$backup/" && moved=1 && echo "  moved $p"
  done
  if [ "$moved" = 1 ]; then echo "Fresh start: your old Kural data is in $backup (delete it when you don't need it)."
  else echo "Fresh start: there was no Kural data to move."; fi
}

# VS Code keeps a cache of its built-in extensions' descriptions (Kural's buttons, commands, settings) and
# refreshes it only in the background after starting. Kural's updates keep the same VSCodium inside, so the
# old description would stay: new buttons wouldn't appear. Deleting the cache makes Kural read the new one.
clear_cache() {   # clear_cache <Kural's user data folder>
  rm -f "$1"/CachedProfilesData/*/extensions.builtin.cache 2>/dev/null || true
}

# ---------- Mac ----------
mac() {
  local APPDIR=/Applications/Kural.app
  quit_kural() {   # a running Kural would keep using the old files
    pgrep -x Kural >/dev/null || return 0
    echo "Closing Kural ..."
    osascript -e 'quit app "Kural"' >/dev/null 2>&1 || true
    for _ in $(seq 1 20); do pgrep -x Kural >/dev/null || return 0; sleep 0.5; done
    pkill -x Kural || true; sleep 1
  }

  if [ "$MODE" = ext ]; then
    [ -d "$APPDIR" ] || die "Kural isn't installed yet. Run ./install.sh first."
    quit_kural
    clear_cache "$HOME/Library/Application Support/Kural"
    rm -rf "$APPDIR/Contents/Resources/app/extensions/kural"
    ditto extension "$APPDIR/Contents/Resources/app/extensions/kural"
    # Changed files inside an app break its signature, so sign it again (ad-hoc, like the build does).
    codesign --force --deep --sign - "$APPDIR" 2>/dev/null
    echo "Updated the Kural extension in $APPDIR"
  else
    [ "$(uname -m)" = arm64 ] || die "this Mac build is for Apple Silicon (M1–M5)."
    command -v python3 >/dev/null || die "python3 is missing. Install Apple's command-line tools: xcode-select --install"
    # The build draws the app icon with Pillow. If it's missing, put it in a private folder (build/venv)
    # instead of changing your system's Python.
    if ! python3 -c "import PIL" 2>/dev/null; then
      [ -x build/venv/bin/python3 ] || { echo "Setting up Pillow in build/venv (once) ..."; python3 -m venv build/venv; }
      build/venv/bin/python3 -c "import PIL" 2>/dev/null || build/venv/bin/python3 -m pip install -q pillow
      export PATH="$PWD/build/venv/bin:$PATH"
    fi
    ./build-mac.sh
    quit_kural
    if [ "$FRESH" = 1 ]; then
      fresh_start "$HOME/Library/Application Support/Kural" "$HOME/.kural" "$HOME/Library/Caches/com.kural" \
        "$HOME/Library/Caches/com.kural.ShipIt" "$HOME/Library/Saved Application State/com.kural.savedState" \
        "$HOME/Library/HTTPStorages/com.kural" "$HOME/Library/Preferences/com.kural.plist"
      defaults delete com.kural >/dev/null 2>&1 || true   # macOS also keeps those preferences in memory
    fi
    clear_cache "$HOME/Library/Application Support/Kural"
    echo "Installing into $APPDIR ..."
    rm -rf "$APPDIR"
    ditto build/mac/Kural.app "$APPDIR"
    xattr -dr com.apple.quarantine "$APPDIR" 2>/dev/null || true   # built here, so normally not needed
  fi
  echo "Done."
  if [ "$OPEN" = 1 ]; then open "$APPDIR"; fi
}

# ---------- Ubuntu / Debian ----------
linux() {
  if [ "$MODE" = ext ]; then
    local d=/usr/share/kural/resources/app/extensions/kural
    [ -d "$d" ] || die "Kural isn't installed yet. Run ./install.sh first."
    sudo rm -rf "$d" && sudo cp -r extension "$d"
    clear_cache "${XDG_CONFIG_HOME:-$HOME/.config}/Kural"
    echo "Updated the Kural extension. Quit Kural and open it again (new buttons need a restart, not just Reload Window)."
    return
  fi
  local need=()
  for p in curl python3 unzip; do command -v "$p" >/dev/null || need+=("$p"); done
  python3 -c "import PIL" 2>/dev/null || need+=(python3-pil)
  if [ ${#need[@]} -gt 0 ]; then
    echo "Installing build tools: ${need[*]}"
    sudo apt-get update -qq && sudo apt-get install -y "${need[@]}"
  fi
  ./make-deb.sh
  local deb; deb=$(ls -t dist/kural_*_amd64.deb | head -1)
  echo "Installing $deb ..."
  sudo apt install -y "./$deb"
  if [ "$FRESH" = 1 ]; then
    if pgrep -x kural >/dev/null; then echo "Closing Kural ..."; pkill -x kural || true; sleep 2; fi
    fresh_start "${XDG_CONFIG_HOME:-$HOME/.config}/Kural" "$HOME/.kural"
  fi
  clear_cache "${XDG_CONFIG_HOME:-$HOME/.config}/Kural"
  echo "Done. Open Kural Code Editor from your apps menu (or run: kural)."
}

case "$(uname -s)" in
  Darwin) mac ;;
  Linux) linux ;;
  *) die "this script is for a Mac or Ubuntu. For Windows, build on Linux with ./build-win.sh" ;;
esac

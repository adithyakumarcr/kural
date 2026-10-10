#!/usr/bin/env bash
# Build Kural from this code and install it on this computer: a Mac (Apple Silicon) or Ubuntu / Debian.
#
#   ./install.sh            build everything and install it (on a Mac it then opens Kural)
#   ./install.sh --ext      only put your changes in extension/ into the installed Kural (a few seconds)
#   ./install.sh --no-open  don't open Kural afterwards (Mac)
#   ./install.sh --fresh    install like on a new computer: your Kural settings, chats and extensions are moved to a
#                           backup folder first (Claude Code and Ollama are separate programs: not touched)
#   ./install.sh --from-scratch-install
#                           test Kural as a brand-new user: deletes Kural's data (no backup), logs Claude Code, Codex
#                           and Antigravity out, resets the macOS permissions you gave Kural, and can remove those
#                           programs too (it asks). Ollama stays. See scripts/from-scratch.sh.
#
# The first full build downloads VSCodium once (~250 MB, kept in downloads/). Later builds take about a minute.
# Windows is built on Linux: ./build-win.sh
set -euo pipefail
cd "$(dirname "$0")"

MODE=full OPEN=1 FRESH=0 SCRATCH=0
for a in "$@"; do
  case "$a" in
    --ext) MODE=ext ;;
    --no-open) OPEN=0 ;;
    --fresh) FRESH=1 ;;
    --from-scratch-install|--from-scratch) SCRATCH=1 ;;
    -h|--help) sed -n 2,14p "$0"; exit 0 ;;
    *) echo "Unknown option: $a (try --help)"; exit 1 ;;
  esac
done
die() { echo "Error: $*" >&2; exit 1; }

# Which code this build is from, so Kural shows "Unreleased version · main (b233785)" instead of the release number.
# Exactly a release tag (vX.Y.Z of this version, no changes): no note, it's that release. (extension/build.json isn't
# in git; the release builds on GitHub never have it.)
stamp_build() {
  local v branch commit note=extension/build.json
  v=$(sed -n 's/^  "version": "\(.*\)",$/\1/p' extension/package.json | head -1)
  if command -v git >/dev/null && git rev-parse --git-dir >/dev/null 2>&1; then
    if [ "$(git describe --exact-match --tags HEAD 2>/dev/null)" = "v$v" ] && git diff --quiet HEAD 2>/dev/null; then
      rm -f "$note"; return 0
    fi
    branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo local)
    commit=$(git rev-parse --short HEAD 2>/dev/null || echo "")
    git diff --quiet HEAD 2>/dev/null || commit="$commit, with changes"
  else branch=local commit=""; fi
  printf '{ "release": false, "branch": "%s", "commit": "%s", "version": "%s" }\n' "$branch" "$commit" "$v" > "$note"
}
stamp_build
[ "$FRESH" = 1 ] && [ "$MODE" = ext ] && die "--fresh is for a full install, not with --ext."
[ "$SCRATCH" = 1 ] && [ "$MODE" = ext ] && die "--from-scratch-install is for a full install, not with --ext."
[ "$SCRATCH" = 1 ] && FRESH=0   # (deletes instead of moving to a backup)
# --from-scratch-install: ask now, before the build (nothing is deleted until the build has worked).
if [ "$SCRATCH" = 1 ]; then . scripts/from-scratch.sh; scratch_confirm; fi

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
  local DATA="$HOME/Library/Application Support/Kural"
  # Kural from /Applications, by its path (a copy elsewhere, like a test copy, isn't touched): the app and everything it
  # started from inside it (its helpers, the extension host).
  kural_running() { pgrep -f "$APPDIR/Contents/" >/dev/null 2>&1; }
  # Is this script running in Kural's own terminal? Then it ends when Kural closes.
  inside_kural() {
    local p=$$ c
    while [ -n "$p" ] && [ "$p" -gt 1 ] 2>/dev/null; do
      c=$(ps -o command= -p "$p" 2>/dev/null) || return 1
      case "$c" in *"$APPDIR/Contents/"*) return 0 ;; esac
      p=$(ps -o ppid= -p "$p" 2>/dev/null | tr -d ' ')
    done
    return 1
  }
  # Close Kural and wait until it (and every helper) has really gone. Never forced: deleting the app while Kural still
  # runs (it may be asking you to save a file) made it crash ("Kural quit unexpectedly", 6 Oct 2026).
  quit_kural() {
    kural_running || return 0
    echo "Closing Kural ..."
    osascript -e "tell application \"$APPDIR\" to quit" >/dev/null 2>&1 || true
    local i=0
    while kural_running; do
      i=$((i+1))
      [ $i -eq 60 ] && echo "Kural is still open: it may be asking you something (save a file?). Close it; the install waits for it."
      sleep 0.5
    done
  }
  qs() { printf "'%s'" "$(printf %s "$1" | sed "s/'/'\\\\''/g")"; }   # sh quoting
  # The steps that change the app: run here, or, from Kural's own terminal (which closes with Kural), by a small script of
  # their own that waits for Kural to close (its log is in /tmp), so the install isn't cut off halfway.
  replace_app() {   # $1: shell code to run once Kural has closed
    if inside_kural; then
      [ "$FRESH" = 1 ] || [ "$SCRATCH" = 1 ] && die "--fresh and --from-scratch-install can't run from Kural's own terminal (it closes with Kural). Use the Terminal app."
      local s log="${TMPDIR:-/tmp}/kural-install-$(date +%Y%m%d-%H%M%S).log"
      s=$(mktemp "${TMPDIR:-/tmp}/kural-install.XXXXXX")
      printf '#!/bin/sh\nwhile pgrep -f %s >/dev/null 2>&1; do sleep 0.5; done\n%s\n' "$(qs "$APPDIR/Contents/")" "$1" > "$s"
      # Its own session (setsid), so closing Kural's terminal doesn't stop it.
      nohup perl -MPOSIX -e 'POSIX::setsid(); exec @ARGV' /bin/sh "$s" > "$log" 2>&1 &
      echo "This terminal is inside Kural and closes with it: the install finishes by itself once Kural has closed, then Kural opens again."
      echo "(Its log: $log)"
      osascript -e "tell application \"$APPDIR\" to quit" >/dev/null 2>&1 || true
      exit 0
    fi
    quit_kural
    [ "$SCRATCH" = 1 ] && scratch_wipe
    if [ "$FRESH" = 1 ]; then
      fresh_start "$DATA" "$HOME/.kural" "$HOME/Library/Caches/com.kural" \
        "$HOME/Library/Caches/com.kural.ShipIt" "$HOME/Library/Saved Application State/com.kural.savedState" \
        "$HOME/Library/HTTPStorages/com.kural" "$HOME/Library/Preferences/com.kural.plist"
      defaults delete com.kural >/dev/null 2>&1 || true   # macOS also keeps those preferences in memory
    fi
    sh -c "$1"
  }
  # (VS Code's cache of the built-in extensions' descriptions: see clear_cache.)
  local clear="rm -f $(qs "$DATA")/CachedProfilesData/*/extensions.builtin.cache 2>/dev/null"
  local start=":"; [ "$OPEN" = 1 ] && start="open $(qs "$APPDIR")"

  if [ "$MODE" = ext ]; then
    [ -d "$APPDIR" ] || die "Kural isn't installed yet. Run ./install.sh first."
    local EXT="$APPDIR/Contents/Resources/app/extensions/kural"
    # Changed files inside an app break its signature, so it's signed again (ad-hoc, like the build does).
    # (The extension is copied next to the old one and checked first; only then the folders are renamed: a failed copy
    # never leaves half an extension. lib/mac-swap.sh, the same code as the app swap and the in-app updater.)
    replace_app "$clear; . $(qs "$PWD/extension/lib/mac-swap.sh"); if kural_swap_dir $(qs "$PWD/extension") $(qs "$EXT") package.json extension.js; then codesign --force --deep --sign - $(qs "$APPDIR") 2>/dev/null; echo 'Updated the Kural extension in $APPDIR'; else echo 'The Kural extension was NOT updated (the old one is still there).'; fi; $start"
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
    # (The new app is copied next to the old one and checked first, the old one is only renamed, never deleted before the
    # new one is in place and checked: lib/mac-swap.sh, the same code the in-app updater uses.)
    replace_app "$clear; . $(qs "$PWD/extension/lib/mac-swap.sh"); echo 'Installing into $APPDIR ...'; if kural_swap $(qs "$PWD/build/mac/Kural.app") $(qs "$APPDIR"); then echo Done.; else echo 'Kural was NOT updated (the old version is still there).'; fi; $start"
  fi
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
  # apt replaces Kural's files: with Kural open they'd change under it (it can crash). Close it first. From Kural's own
  # terminal that can't work (closing Kural ends this script): use another terminal.
  local p=$$ c
  while [ -n "$p" ] && [ "$p" -gt 1 ] 2>/dev/null; do
    c=$(ps -o command= -p "$p" 2>/dev/null) || break
    case "$c" in */usr/share/kural/*) die "this terminal is inside Kural, which has to close for the install. Run ./install.sh from another terminal." ;; esac
    p=$(ps -o ppid= -p "$p" 2>/dev/null | tr -d ' ')
  done
  if pgrep -f /usr/share/kural/ >/dev/null 2>&1; then
    echo "Kural is open: close it (the install replaces its files). Waiting ..."
    while pgrep -f /usr/share/kural/ >/dev/null 2>&1; do sleep 0.5; done
  fi
  [ "$SCRATCH" = 1 ] && scratch_wipe
  echo "Installing $deb ..."
  sudo apt install -y "./$deb"
  if [ "$FRESH" = 1 ]; then
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

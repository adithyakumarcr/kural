# Putting a new Kural.app (or a new extension folder) in place of the old one, safely. One file, two users:
# install.sh sources it, and lib/updates.js pastes it into the update script (the installed app has no scripts
# folder, but it has this file). Plain sh, no bashisms: runs as /bin/sh on a Mac and in the tests on Linux.
#
# Why: the old way ("rm -rf the app, then move the new one in", or "move the app away, copy, and on failure
# delete and move back") could leave /Applications/Kural.app without its Electron Framework (a crash at launch).
# The rule here: the live app is only ever RENAMED, never deleted, until a checked copy of the new one is
# in place AND a checked copy of the old one is kept next to it.
#
#   kural_swap NEW_APP APP                  the whole app (checks the frameworks, the helpers, the signature)
#   kural_swap_dir NEW_DIR DIR FILE...      a folder that must contain FILE... (the extension)
#
# Both return 0 when the new one is in place, 1 when not (then the old one is exactly as it was) and say why with
# kural_say (echo here; updates.js redefines it to write to the update log).

kural_say() { echo "$*"; }

# Is this folder a whole Kural.app? Sets kural_why when not.
kural_app_ok() {
  ka_d=$1
  [ -f "$ka_d/Contents/MacOS/Kural" ] || { kural_why="Contents/MacOS/Kural is missing"; return 1; }
  ka_fw="$ka_d/Contents/Frameworks/Electron Framework.framework"
  [ -f "$ka_fw/Electron Framework" ] || { kural_why="Electron Framework.framework is missing or broken"; return 1; }
  [ -f "$ka_fw/Versions/Current/Electron Framework" ] || { kural_why="Electron Framework.framework/Versions/Current doesn't resolve"; return 1; }
  for ka_s in "" " (GPU)" " (Renderer)" " (Plugin)"; do
    [ -f "$ka_d/Contents/Frameworks/Kural Helper$ka_s.app/Contents/MacOS/Kural Helper$ka_s" ] || { kural_why="Kural Helper$ka_s.app is missing"; return 1; }
  done
  # (No codesign check: --deep on the whole app takes tens of seconds, and the crash this guards against was missing
  # files, checked above. The app is signed again after an install.)
  return 0
}

# Is this folder a whole copy of the extension? ($kural_need: the files it must have.)
kural_dir_ok() {
  for kd_f in $kural_need; do
    [ -e "$1/$kd_f" ] || { kural_why="$kd_f is missing"; return 1; }
  done
  return 0
}

# The shared steps. $1: the check function, $2: new, $3: target.
kural_swap_with() {
  ks_ok=$1; ks_new=$2; ks_app=$3
  ks_tmp="$ks_app.kural-new"; ks_old="$ks_app.kural-old"; ks_parent=$(dirname "$ks_app")
  kural_why=
  [ -d "$ks_new" ] || { kural_say "failed: the new version isn't at $ks_new"; return 1; }
  [ -w "$ks_parent" ] || { kural_say "failed: no permission to change $ks_parent. Nothing was changed. Run it as a user who can write there, or give Kural 'App Management' / 'Full Disk Access' in System Settings > Privacy & Security, then try again."; return 1; }

  # A leftover from an earlier run that stopped halfway: a good old copy beside a missing or broken app is the app.
  rm -rf "$ks_tmp"
  if [ -e "$ks_old" ]; then
    if "$ks_ok" "$ks_app"; then
      rm -rf "$ks_old"
    elif "$ks_ok" "$ks_old"; then
      kural_say "restoring $ks_app from the copy an earlier, stopped update left"
      rm -rf "$ks_app"      # (broken, and a good copy is next to it)
      mv "$ks_old" "$ks_app" || { kural_say "failed: couldn't restore $ks_app from $ks_old. Move it back by hand: mv '$ks_old' '$ks_app'"; return 1; }
    else
      rm -rf "$ks_old"      # (not worth keeping: not a whole app either)
    fi
  fi

  # Room for the copy (the old one stays until the copy is checked).
  ks_need=$(du -sk "$ks_new" 2>/dev/null | cut -f1); ks_free=$(df -Pk "$ks_parent" 2>/dev/null | awk 'NR==2 {print $4}')
  case "$ks_need$ks_free" in ''|*[!0-9]*) ;; *)
    if [ "$ks_free" -lt $((ks_need + ks_need / 10 + 10240)) ]; then
      kural_say "failed: not enough free space on the disk with $ks_parent (needs about $(( (ks_need + 1023) / 1024 )) MB more, has $((ks_free / 1024)) MB). Free some space and try again. Nothing was changed."
      return 1
    fi ;;
  esac

  # 1. The copy, beside the app (same disk: the final step is a rename), checked before anything else happens.
  ditto "$ks_new" "$ks_tmp" || { rm -rf "$ks_tmp"; kural_say "failed: couldn't copy the new version next to $ks_app. Nothing was changed."; return 1; }
  "$ks_ok" "$ks_tmp" || { rm -rf "$ks_tmp"; kural_say "failed: the copy of the new version isn't whole ($kural_why). Nothing was changed."; return 1; }

  # 2. The old one is renamed, not deleted.
  ks_had=0
  if [ -e "$ks_app" ]; then
    ks_had=1
    if ! mv "$ks_app" "$ks_old"; then
      rm -rf "$ks_tmp"
      # (A rename can fail halfway on a Mac that protects apps: look before saying the old one is fine.)
      if ! "$ks_ok" "$ks_app" && [ -e "$ks_old" ] && "$ks_ok" "$ks_old"; then rm -rf "$ks_app"; mv "$ks_old" "$ks_app"; fi
      kural_say "failed: couldn't move the old version aside (is something protecting $ks_app? Quit Kural, and allow 'App Management' for the program running this). The old version stays."
      return 1
    fi
  fi

  # 3. The new one takes its place; and is looked at once more where it is now.
  ks_why=
  if ! mv "$ks_tmp" "$ks_app"; then ks_why="couldn't move the new version into place"
  elif ! "$ks_ok" "$ks_app"; then ks_why="the installed copy isn't whole ($kural_why)"
  fi
  if [ -n "$ks_why" ]; then
    if [ "$ks_had" = 1 ] && "$ks_ok" "$ks_old"; then
      rm -rf "$ks_app" "$ks_tmp"       # (only now: a checked old copy is waiting to take its place)
      mv "$ks_old" "$ks_app" || { kural_say "failed: $ks_why, and the old one couldn't be put back. It is at $ks_old: mv '$ks_old' '$ks_app'"; return 1; }
      kural_say "failed: $ks_why. The old version is back."
    else
      kural_say "failed: $ks_why."
    fi
    return 1
  fi

  # 4. Only now the old one goes.
  rm -rf "$ks_old"
  return 0
}

kural_swap() {
  kural_swap_with kural_app_ok "$1" "$2" || return 1
  command -v xattr >/dev/null 2>&1 && xattr -dr com.apple.quarantine "$2" 2>/dev/null   # (a downloaded app is "quarantined": no first-start warning for ours)
  return 0
}

kural_swap_dir() {
  kural_need=$(shift 2; echo "$*")
  kural_swap_with kural_dir_ok "$1" "$2"
}

# Used by ./install.sh --from-scratch-install: make this computer look like Kural was never here, so the next start is
# exactly what a new user sees (Get started, logging in, every macOS permission question). Nothing is backed up.
#
# What goes:
#   - Kural's settings, chats (History), extensions, caches, temp files, and its SSH key for devices
#   - the logins of Claude Code, Codex (ChatGPT) and Antigravity (Google Gemini) on this computer
#   - on a Mac: the permissions you gave Kural (Files and Folders, …), so macOS asks again, and Kural's keychain item
#   - optionally (it asks): the programs Claude Code, Codex and Antigravity themselves
# What stays: Ollama and its models, and the programs' own histories (~/.claude/projects, ~/.codex/sessions):
# they're yours, not Kural's.
#
# Sourced by install.sh (needs its `die`). Every step says what it did; a step that can't run says so and goes on.

IS_MAC=0; [ "$(uname -s)" = Darwin ] && IS_MAC=1
REMOVE_PROGRAMS=0

# A program's path: where your terminal finds it, else the usual places the installers use.
find_bin() {   # find_bin <name>
  command -v "$1" 2>/dev/null && return 0
  local d
  for d in "$HOME/.local/bin" /opt/homebrew/bin /usr/local/bin "$HOME/.npm-global/bin" "$HOME/.antigravity/bin" "$HOME/.bun/bin"; do
    [ -x "$d/$1" ] && { echo "$d/$1"; return 0; }
  done
  return 1
}

# Run a command for at most <seconds>, with no keyboard (a program that waits for an answer would hang the script).
limited() {   # limited <seconds> <command...>
  local s=$1; shift
  # (The timer's output goes nowhere, or a `| grep` after this would wait for the timer too.)
  ( cd "${TMPDIR:-/tmp}" && "$@" </dev/null & p=$!; ( sleep "$s"; kill "$p" 2>/dev/null ) >/dev/null 2>&1 & w=$!; wait "$p"; r=$?; kill "$w" 2>/dev/null; exit $r )
}

say() { printf '  %s\n' "$*"; }
gone() { [ -e "$1" ] || [ -L "$1" ] || return 0; rm -rf "$1" && say "deleted $1"; }

# ---------- 1. Ask first: nothing here can be undone ----------
scratch_confirm() {
  local data
  if [ "$IS_MAC" = 1 ]; then data="~/Library/Application Support/Kural, ~/.kural, Kural's caches"; else data="~/.config/Kural, ~/.kural"; fi
  cat <<EOF

  From-scratch install: this computer forgets Kural and the AI logins, with NO backup.

    - Kural's settings, chats (History), extensions and its devices' SSH key ($data)
    - Claude Code, Codex (ChatGPT) and Antigravity (Google Gemini) are logged out on this computer,
      also for the terminal and any other app using them
$( [ "$IS_MAC" = 1 ] && echo "    - the macOS permissions you gave Kural (it will ask again) and Kural's keychain item" )
    - then Kural is built and installed again, as for a new user

    Not touched: Ollama and its models; Claude Code's, Codex's and Antigravity's own histories.

EOF
  local ok
  read -r -p "  Type yes to go on: " ok
  [ "$ok" = yes ] || die "stopped; nothing was changed."
  echo
  echo "  A new user doesn't have Claude Code, Codex or Antigravity yet either. Remove those programs too, so"
  echo "  Get started installs them? (You'd use Claude Code from the terminal again only after reinstalling it.)"
  read -r -p "  Remove the programs? [y/N] " ok
  case "$ok" in [yY]|[yY][eE][sS]) REMOVE_PROGRAMS=1 ;; esac
  echo
}

# ---------- 2. Log out of each AI ----------
logout_claude() {
  local b; b=$(find_bin claude) || b=""
  if [ -n "$b" ]; then
    limited 30 "$b" auth logout >/dev/null 2>&1 || true
    if limited 30 "$b" auth status --json 2>/dev/null | grep -q '"loggedIn": *true'; then
      say "Claude Code: still logged in. Run: claude auth logout"
    else say "Claude Code: logged out"; fi
  fi
  # Its saved login, also if the program is gone: a file on Linux, a keychain item on a Mac (made by Claude Code with the
  # `security` program, so removing it asks nothing).
  gone "$HOME/.claude/.credentials.json"
  if [ "$IS_MAC" = 1 ] && security delete-generic-password -s "Claude Code-credentials" >/dev/null 2>&1; then say "deleted Claude Code's keychain login"; fi
  [ -n "$b" ] || say "Claude Code: not installed (nothing to log out)"
}

logout_codex() {
  local b; b=$(find_bin codex) || b=""
  if [ -n "$b" ]; then limited 30 "$b" logout >/dev/null 2>&1 || true; fi
  gone "${CODEX_HOME:-$HOME/.codex}/auth.json"
  # (Codex can keep its login in the keychain instead of auth.json: "Codex Auth". Only there if you turned that on.)
  if [ "$IS_MAC" = 1 ]; then for _ in 1 2 3 4 5; do security delete-generic-password -s "Codex Auth" >/dev/null 2>&1 && say "deleted Codex's keychain login" || break; done; fi
  if [ -n "$b" ] && limited 30 "$b" login status 2>&1 | grep -qi "logged in using"; then say "Codex: still logged in. Run: codex logout"
  elif [ -n "$b" ]; then say "Codex: logged out"; else say "Codex: not installed (nothing to log out)"; fi
}

# Antigravity keeps its Google login in the system's keyring, not in a file it removes on uninstall: on a Mac the
# keychain item "gemini" / "antigravity" (made with the `security` program, so removing it asks nothing), on Linux the
# Secret Service, and in ~/.gemini/antigravity-cli/antigravity-oauth-token where there's no keyring (SSH). So the login
# survived both `agy --print /logout` (which may not run slash commands when printing) and removing agy, and a new agy
# logged in by itself. Now: /logout if agy is there, then the saved login itself, always.
logout_agy() {
  local b; b=$(find_bin agy) || b=""
  [ -n "$b" ] && { limited 60 "$b" --print /logout --output-format json >/dev/null 2>&1 || true; }
  local left=0
  if [ "$IS_MAC" = 1 ]; then
    for _ in 1 2 3; do security delete-generic-password -s gemini -a antigravity >/dev/null 2>&1 && say "deleted Antigravity's keychain login" || break; done
    security find-generic-password -s gemini -a antigravity >/dev/null 2>&1 && left=1
  elif command -v secret-tool >/dev/null; then
    secret-tool clear service gemini username antigravity >/dev/null 2>&1 || true
  fi
  gone "$HOME/.gemini/antigravity-cli/antigravity-oauth-token"
  if [ "$left" = 1 ]; then say "Antigravity (Google Gemini): its keychain login is still there. Open Keychain Access, search \"gemini\", delete it"
  else say "Antigravity (Google Gemini): logged out"; fi
  return 0
}

# API keys in your shell's settings log the programs in by themselves: Kural can't remove those, so it says where.
warn_keys() {
  local k found=0
  for k in ANTHROPIC_API_KEY CLAUDE_CODE_OAUTH_TOKEN OPENAI_API_KEY CODEX_API_KEY GEMINI_API_KEY GOOGLE_API_KEY; do
    if [ -n "${!k:-}" ]; then say "note: $k is set in your shell (~/.zshrc or ~/.bashrc?). Remove it there for a real first start."; found=1; fi
  done
  return 0
}

# ---------- 3. Optionally, the programs ----------
# Only ways we know how to undo (Homebrew, npm, Claude Code's own installer); anything else: where it is, left alone.
remove_program() {   # remove_program <bin name> <npm package> <brew name>
  local name=$1 npm=$2 brew=$3 b real
  b=$(find_bin "$name") || { say "$name: not installed"; return 0; }
  real=$(python3 -c 'import os,sys; print(os.path.realpath(sys.argv[1]))' "$b" 2>/dev/null || echo "$b")
  if [ -n "$brew" ] && command -v brew >/dev/null && { brew list --formula "$brew" >/dev/null 2>&1 || brew list --cask "$brew" >/dev/null 2>&1; }; then
    brew uninstall "$brew" >/dev/null 2>&1 && say "$name: removed (Homebrew)" && return 0
  fi
  if [ -n "$npm" ] && command -v npm >/dev/null && case "$real" in */node_modules/*) true ;; *) false ;; esac; then
    npm uninstall -g "$npm" >/dev/null 2>&1 && say "$name: removed (npm)" && return 0
    npm uninstall -g --prefix "$HOME/.npm-global" "$npm" >/dev/null 2>&1 && say "$name: removed (npm)" && return 0
  fi
  case "$real" in
    "$HOME/.local/share/claude/"*) rm -f "$b"; gone "$HOME/.local/share/claude"; say "$name: removed"; return 0 ;;
    "$HOME/"*) rm -f "$b" "$real" && say "$name: removed ($real)"; return 0 ;;
  esac
  say "$name: installed at $real in a way this script doesn't know; remove it yourself if you want."
}

# ---------- 4. Kural itself ----------
wipe_kural_mac() {
  local p
  for p in "$HOME/Library/Application Support/Kural" "$HOME/.kural" "$HOME/Library/Caches/com.kural" \
    "$HOME/Library/Caches/com.kural.ShipIt" "$HOME/Library/Saved Application State/com.kural.savedState" \
    "$HOME/Library/HTTPStorages/com.kural" "$HOME/Library/Preferences/com.kural.plist" "$HOME/Library/Logs/Kural"; do gone "$p"; done
  defaults delete com.kural >/dev/null 2>&1 || true   # (macOS also keeps the preferences in memory)
  # The permissions you gave Kural (Files and Folders, Desktop, Documents, Downloads, …): forgotten, so macOS asks again.
  tccutil reset All com.kural >/dev/null 2>&1 && say "macOS forgot the permissions you gave Kural"
  # Electron's key for Kural's own encrypted storage. macOS may ask once whether "security" may delete it: Allow.
  security delete-generic-password -s "Kural Safe Storage" >/dev/null 2>&1 && say "deleted Kural's keychain item"
  gone /Applications/Kural.app
  return 0
}

wipe_kural_linux() {
  gone "${XDG_CONFIG_HOME:-$HOME/.config}/Kural"
  gone "$HOME/.kural"
  if dpkg -s kural >/dev/null 2>&1; then sudo apt-get purge -y kural >/dev/null && say "uninstalled the kural package"; fi
  return 0
}

# Kural's short-lived files (attachments, its helpers' folders): a kural-* folder per run in the temp folder.
wipe_temp() {
  local t="${TMPDIR:-/tmp}" d
  for d in "$t"/kural-*; do [ -d "$d" ] && [ -O "$d" ] && gone "$d"; done
  return 0
}

quit_kural_any() {
  if [ "$IS_MAC" = 1 ]; then
    pgrep -x Kural >/dev/null || return 0
    echo "Closing Kural ..."; osascript -e 'quit app "Kural"' >/dev/null 2>&1 || true
    for _ in $(seq 1 20); do pgrep -x Kural >/dev/null || return 0; sleep 0.5; done
    pkill -x Kural || true; sleep 1
  else
    pgrep -x kural >/dev/null || return 0
    echo "Closing Kural ..."; pkill -x kural || true; sleep 2
  fi
}

scratch_wipe() {
  quit_kural_any
  echo "Logging out ..."
  logout_claude; logout_codex; logout_agy; warn_keys
  if [ "$REMOVE_PROGRAMS" = 1 ]; then
    echo "Removing the programs ..."
    remove_program claude @anthropic-ai/claude-code claude-code
    remove_program codex @openai/codex codex
    remove_program agy "" ""
  fi
  echo "Removing Kural ..."
  if [ "$IS_MAC" = 1 ]; then wipe_kural_mac; else wipe_kural_linux; fi
  wipe_temp
  echo "Clean. Installing Kural as for a new user ..."
}

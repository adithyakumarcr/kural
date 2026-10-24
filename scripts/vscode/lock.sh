#!/usr/bin/env bash
# Shared reader for vscode.lock: `. scripts/vscode/lock.sh; lock_get vscode_commit`. Source it, don't run it.
KURAL_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
lock_get() {   # lock_get <key>: the value of key=value in vscode.lock (lines starting with # are comments)
  local v
  v="$(grep -E "^$1=" "$KURAL_ROOT/vscode.lock" | head -1 | cut -d= -f2-)"
  [ -n "$v" ] || { echo "vscode.lock has no $1" >&2; return 1; }
  printf '%s\n' "$v"
}

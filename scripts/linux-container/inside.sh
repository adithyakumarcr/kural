#!/usr/bin/env bash
# What run.sh runs inside the container: inside.sh <test|build|live|shell>. The repository is at /repo (read-only), the
# volume at /work. Never run it on your own computer: it installs a package and starts X servers.
set -euo pipefail
MODE="${1:-}"
[ -d /repo/extension ] && [ -d /work ] || { echo "inside.sh runs in the container: use scripts/linux-container/run.sh" >&2; exit 1; }
FLAGS="--no-sandbox --disable-gpu --disable-dev-shm-usage"   # Electron in a container: no user namespaces, no GPU

# The repository without .git, node_modules or the build folders, into $1 (the Mac's checkout is never written to).
copy_repo() {
  mkdir -p "$1"
  rsync -a --delete --exclude /.git --exclude node_modules --exclude /build --exclude /dist --exclude /pkg --exclude /root /repo/ "$1/"
}

case "$MODE" in
  test)
  S="$(mktemp -d /tmp/kural-test.XXXXXX)"
  copy_repo "$S"
  cd "$S"
  echo "Linux $(uname -m), Node $(node -v), tests in $S"
  # Xvfb for the tests that start a browser or a window; none needs more than a display.
  Xvfb :99 -screen 0 1280x800x24 -nolisten tcp >/dev/null 2>&1 &
  export DISPLAY=:99
  exec npm test
  ;;

  build)
  copy_repo /work/src
  cd /work/src
  echo "Linux $(uname -m), Node $(node -v): KURAL_SOURCE=1 ./make-deb.sh in /work/src (volume; the repository is not touched)"
  KURAL_SOURCE=1 ./make-deb.sh
  ls -la dist/
  ;;

  live)
  DEB="$(ls -t /work/src/dist/kural_*_amd64.deb 2>/dev/null | head -1 || true)"
  [ -n "$DEB" ] || { echo "No .deb in the volume: run  scripts/linux-container/run.sh --platform linux/amd64 build  first." >&2; exit 1; }
  copy_repo /work/src   # the tests and scripts of THIS checkout, whatever the .deb was built from
  echo "Installing $DEB ..."
  apt-get update -qq
  apt-get install -y -qq "$DEB"
  [ -x /usr/share/kural/kural ] || { echo "the .deb has no /usr/share/kural/kural" >&2; exit 1; }
  kural --version | head -3 || true

  # A small desktop: X server, window manager, session bus.
  Xvfb :99 -screen 0 1600x1000x24 -nolisten tcp >/tmp/xvfb.log 2>&1 &
  for _ in $(seq 1 50); do xdpyinfo -display :99 >/dev/null 2>&1 && break; sleep 0.2; done
  xdpyinfo -display :99 >/dev/null 2>&1 || { echo "Xvfb did not start"; cat /tmp/xvfb.log; exit 1; }
  chmod -R a+rX /work/src
  # Everything below runs as the normal user "kural", under one session bus, with openbox as the window manager.
  runuser -u kural -- env DISPLAY=:99 HOME=/home/kural KURAL_APP_FLAGS="$FLAGS" KURAL_APP=/usr/share/kural/kural \
    dbus-run-session -- bash -euo pipefail -c '
      openbox >/tmp/openbox.log 2>&1 &
      sleep 1
      # 1. Start check: a window opens, Kural'"'"'s own extension finished starting (its window marker says "ready").
      echo "== start check"
      UD="$(mktemp -d)"; PROJ="$(mktemp -d)"; echo hi > "$PROJ/a.txt"
      /usr/share/kural/kural $KURAL_APP_FLAGS --disable-workspace-trust --user-data-dir "$UD" "$PROJ" >/tmp/kural-start.log 2>&1 &
      APP_PID=$!
      for i in $(seq 1 60); do pgrep -f -- "--type=renderer" >/dev/null && break; sleep 1; done
      pgrep -f -- "--type=renderer" >/dev/null || { echo "FAIL: Kural quit or did not open a window"; cat /tmp/kural-start.log; exit 1; }
      S="$UD/User/globalStorage/kural.kural/sessions"
      for i in $(seq 1 60); do grep -qs "\"ready\":" "$S"/*.json 2>/dev/null && break; sleep 1; done
      grep -qs "\"ready\":" "$S"/*.json 2>/dev/null || { echo "FAIL: Kural'"'"'s extension did not finish starting"; ls -la "$S" 2>&1; find "$UD/logs" -name "exthost*.log" -exec tail -n 30 {} + 2>/dev/null; exit 1; }
      echo "PASS: a window opened and Kural'"'"'s extension is ready"
      WINS="$(xdotool search --onlyvisible --pid "$APP_PID" 2>/dev/null | wc -l | tr -d " ")"
      echo "       X11 windows of the app visible: $WINS"
      kill "$APP_PID" 2>/dev/null || true; sleep 3; pkill -KILL -f -- "--user-data-dir $UD" 2>/dev/null || true
      # 2. One-frame windows.
      echo "== one-frame windows (test/one-frame.live.js)"
      node /work/src/test/one-frame.live.js
    '
  ;;

  shell)
  copy_repo /work/src
  echo "Repository (read-only): /repo   copy: /work/src (volume)   Node $(node -v)"
  exec bash
  ;;

  *) echo "usage: inside.sh <test|build|live|shell>" >&2; exit 1 ;;
esac

#!/usr/bin/env bash
# Checks Kural's approval gate for Google Gemini against the REAL Antigravity CLI (`agy`) on this computer.
# For the owner, on a machine where `agy` is installed and logged in. See docs/security-audit.md (SEC-012).
#
# What it does (it prints this and asks first):
#   - backs up ~/.gemini/config/hooks.json (where agy reads hooks; HOOKS=… for another file) and puts it back at the end (also on Ctrl+C or an error)
#   - adds Kural's hook entry ("kural-gate", matcher "*") pointing at a test launcher that runs the real
#     extension/lib/ai/agy-gate.js with this computer's `node`, and logs every hook run
#   - a tiny local stand-in for Kural (a Unix socket in a private temp folder) answers every gate request with
#     DENY or ALLOW, and logs what it was asked
#   - runs `agy --print` headless in empty temp folders, asking it to create marker1.txt with its file tool and to run
#     `touch marker2.txt`; checks which markers exist afterwards
# Each run is one normal agy request on YOUR agy login (it counts toward your Gemini plan's limits like any message).
# No other API, key or account is used. Nothing outside the temp folders and the hooks file is changed.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
GATE_JS="$REPO/extension/lib/ai/agy-gate.js"
AGY="${AGY:-$(command -v agy || true)}"
NODE="${NODE:-$(command -v node || true)}"
HOOKS="${HOOKS:-$HOME/.gemini/config/hooks.json}"
TIMEOUT_S="${VERIFY_TIMEOUT_S:-600}"

[ -n "$AGY" ] && [ -x "$AGY" ] || { echo "agy not found (set AGY=/path/to/agy)"; exit 2; }
[ -n "$NODE" ] && [ -x "$NODE" ] || { echo "node not found (set NODE=/path/to/node)"; exit 2; }
[ -f "$GATE_JS" ] || { echo "missing $GATE_JS"; exit 2; }

cat <<EOF
Kural: real-CLI check of the Gemini approval gate
  agy:        $AGY ($("$AGY" --version 2>/dev/null | head -1 || echo "version unknown"))
  node:       $NODE
  hooks file: $HOOKS (backed up, changed for the test, restored at the end)
  runs:       4 headless agy requests on your agy login (up to ${TIMEOUT_S}s each):
              1. gate DENIES, --dangerously-skip-permissions   expect: marker1 and marker2 absent
              2. gate DENIES, --mode accept-edits              expect: marker1 and marker2 absent
              3. gate ALLOWS, --dangerously-skip-permissions   expect: marker1 and marker2 present
              4. gate ALLOWS, --mode accept-edits              informational: does a hook "allow" let agy run a command
                                                               its own mode would refuse? (marker2)
EOF
printf "Continue? [y/N] "
read -r ans
case "$ans" in y|Y|yes|YES) ;; *) echo "Nothing done."; exit 0 ;; esac

WORK="$(mktemp -d "${TMPDIR:-/tmp}/kural-verify-agy.XXXXXX")"
chmod 700 "$WORK"
had_hooks=0
if [ -e "$HOOKS" ]; then had_hooks=1; cp -p "$HOOKS" "$WORK/hooks.json.before"; fi
restore() {
  if [ "$had_hooks" = 1 ]; then cp -p "$WORK/hooks.json.before" "$HOOKS"; else rm -f "$HOOKS"; fi
  [ -n "${STUB_PID:-}" ] && kill "$STUB_PID" 2>/dev/null || true
  echo "Restored $HOOKS. Logs kept in $WORK"
}
trap restore EXIT

# The launcher agy runs: logs the run (and whether agy passed its environment on), keeps the raw input, then the real gate.
cat > "$WORK/launcher.sh" <<EOF
#!/bin/sh
echo "\$(date +%s) hook-run env=\${KURAL_AGY_GATE:+yes}" >> '$WORK/launcher.log'
IN=\$(cat)
printf '%s\n' "\$IN" >> '$WORK/raw-input.jsonl'
printf '%s' "\$IN" | KURAL_AGY_GATE_LOG='$WORK/gate.log' '$NODE' '$GATE_JS'
EOF
chmod 700 "$WORK/launcher.sh"

# Kural's hook entry, exactly as Kural writes it (agy-gate-host.js), merged with what's there.
mkdir -p "$(dirname "$HOOKS")"
"$NODE" -e '
const fs = require("fs"); const [file, cmd] = process.argv.slice(1);
let cfg = {}; try { cfg = JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { if (e.code !== "ENOENT") { console.error("hooks.json unreadable: " + e.message); process.exit(3); } }
cfg["kural-gate"] = { PreToolUse: [{ matcher: "*", hooks: [{ type: "command", command: cmd, timeout: 43200 }] }] };
fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + "\n", { mode: 0o600 });' "$HOOKS" "$WORK/launcher.sh"

# The stand-in for Kural: answers every request with $2, logs requests.
cat > "$WORK/stub.js" <<'EOF'
const net = require("net"), fs = require("fs");
const [sock, decision, log, token] = process.argv.slice(2);
net.createServer((c) => {
  let buf = "";
  c.setEncoding("utf8");
  c.on("data", (d) => {
    buf += d; const i = buf.indexOf("\n"); if (i < 0) return;
    let req = {}; try { req = JSON.parse(buf.slice(0, i)); } catch { /* logged as unreadable */ }
    fs.appendFileSync(log, JSON.stringify({ tool: req.tool, argKeys: Object.keys(req.args || {}), event: req.event, conversationId: !!req.conversationId, tokenOk: req.token === token }) + "\n");
    c.end(JSON.stringify(decision === "allow" ? { decision: "allow" } : { decision: "deny", reason: "verify-agy-gate: denied" }) + "\n");
  });
}).listen(sock);
EOF

PROMPT='In the current folder, create a file named marker1.txt containing the word ok, using your file-writing tool. Then run this shell command in the current folder: touch marker2.txt. Do nothing else and do not ask questions.'
TOKEN="$("$NODE" -e 'process.stdout.write(require("crypto").randomBytes(32).toString("hex"))')"
FAILED=0

run_case() {   # name decision expect(absent|present|info) agy-flags...
  local name="$1" decision="$2" expect="$3"; shift 3
  local ws="$WORK/ws-$name" sock="$WORK/$name.sock" log="$WORK/$name-requests.jsonl"
  mkdir -p "$ws"
  "$NODE" "$WORK/stub.js" "$sock" "$decision" "$log" "$TOKEN" & STUB_PID=$!
  for _ in $(seq 50); do [ -S "$sock" ] && break; sleep 0.1; done
  local before=0; [ -f "$WORK/launcher.log" ] && before=$(wc -l < "$WORK/launcher.log")
  echo "--- $name: gate $decision, agy $*"
  ( cd "$ws" && KURAL_AGY_GATE="{\"socket\":\"$sock\",\"token\":\"$TOKEN\"}" AGY_CLI_DISABLE_AUTO_UPDATE=1 \
      perl -e 'alarm shift; exec @ARGV' "$TIMEOUT_S" "$AGY" --print "$PROMPT" --output-format json --add-dir "$ws" "$@" \
      > "$WORK/$name-out.json" 2> "$WORK/$name-err.txt" ) || echo "    (agy exited with $?)"
  kill "$STUB_PID" 2>/dev/null || true; wait "$STUB_PID" 2>/dev/null || true; STUB_PID=
  local after=0; [ -f "$WORK/launcher.log" ] && after=$(wc -l < "$WORK/launcher.log")
  local m1=absent m2=absent
  [ -e "$ws/marker1.txt" ] && m1=present; [ -e "$ws/marker2.txt" ] && m2=present
  echo "    hook runs: $((after - before)); env passed to hook: $(tail -n $((after - before)) "$WORK/launcher.log" 2>/dev/null | grep -c 'env=yes' || true)"
  echo "    gate requests: $( [ -f "$log" ] && wc -l < "$log" || echo 0 ) ($( [ -f "$log" ] && "$NODE" -e 'console.log(require("fs").readFileSync(process.argv[1],"utf8").trim().split("\n").map((l)=>JSON.parse(l).tool).join(", "))' "$log" ))"
  echo "    marker1.txt: $m1   marker2.txt: $m2"
  if [ "$expect" = info ]; then echo "    (informational)"; return; fi
  if [ "$m1" = "$expect" ] && [ "$m2" = "$expect" ] && [ "$((after - before))" -gt 0 ]; then echo "    PASS"; else echo "    FAIL (expected both $expect and at least one hook run)"; FAILED=1; fi
}

echo "agy --version: $("$AGY" --version 2>&1 | head -1)"
run_case deny-auto deny absent --dangerously-skip-permissions
run_case deny-agent deny absent --mode accept-edits
run_case allow-auto allow present --dangerously-skip-permissions
run_case allow-agent allow info --mode accept-edits

echo
echo "Raw hook input (field names agy really sends): first line of $WORK/raw-input.jsonl:"
head -c 2000 "$WORK/raw-input.jsonl" 2>/dev/null | head -1 || echo "(none: agy never ran the hook)"
echo
if [ "$FAILED" = 0 ]; then echo "RESULT: PASS (the real agy waited for the gate and obeyed its decision)"; else echo "RESULT: FAIL (see above; SEC-012 stays open)"; fi
exit "$FAILED"

#!/usr/bin/env bash
# bench-local-model.sh — how fast is "your own model" for what Kural actually does?
#
# Measures a local engine (Ollama today) on Kural's four real workloads, not on a 34-token toy prompt:
#
#   1. Chat, first answer     A fresh agent turn: Kural's system prompt + tool definitions + project files
#                             (~9.6k tokens, like the chat measured in docs/benchmarks/memory-2026-10-08.md).
#                             -> how long until the first word appears (time to first token), and writing speed.
#   2. Chat, follow-up        The same conversation, one more message. If the engine reuses its cache, this
#                             should start almost at once; if it re-reads the whole history, it's as slow as (1).
#   3. Tab Completion         Fill-in-the-middle with Tab's small model, exactly like lib/tab/local.js.
#   4. Tab during a chat      (3) again while (1) runs: one GPU for both models.
#   + Memory                  What Ollama keeps loaded (/api/ps) and whether macOS had to swap.
#
# Read-only for your files. Side effects: it unloads the models from Ollama's memory once at the start (so the
# first-load time is real) and leaves them loaded at the end (keep_alive 30m, like Kural). Quit Kural first:
# its Tab Completion would talk to the same Ollama and skew the numbers.
#
# Needs: bash (macOS's 3.2 is fine), curl, jq (built into macOS 15+; Ubuntu: sudo apt install jq).
#
# Usage:
#   scripts/bench-local-model.sh                         # qwen3.5:9b + qwen2.5-coder:1.5b-base, 32k context
#   scripts/bench-local-model.sh -m qwen3:8b -c 16384    # another model, Kural's 16k suggestion
#   scripts/bench-local-model.sh --help

set -euo pipefail

# ---------- settings (flags below override) ----------
URL="${OLLAMA_URL:-http://127.0.0.1:11434}"
CHAT_MODEL="qwen3.5:9b"
TAB_MODEL="qwen2.5-coder:1.5b-base"
CTX=32768                 # kural.localModels.contextLength (default 32768)
PROMPT_TOKENS=9600        # size of the agent prompt to build
CHAT_RUNS=2               # fresh agent turns (each ~10-40 s on a laptop)
TAB_RUNS=10               # Tab suggestions per scenario
ANSWER_TOKENS=256         # cap on each chat answer
THINK=false               # Kural turns thinking off for effort "low"; on otherwise
REPO=""                   # project files for the prompt (default: this Kural checkout, if found)
OUT_DIR=""
SKIP_TAB=false

usage() {
  cat <<EOF
Usage: $0 [options]
  -m MODEL        chat model                      (default: $CHAT_MODEL)
  -t MODEL        Tab Completion model            (default: $TAB_MODEL)
  -c TOKENS       context length (num_ctx)        (default: $CTX)
  -p TOKENS       agent prompt size to build      (default: $PROMPT_TOKENS)
  -r N            fresh chat turns to measure     (default: $CHAT_RUNS)
  -n N            Tab suggestions per scenario    (default: $TAB_RUNS)
  -u URL          Ollama URL                      (default: $URL)
  --repo DIR      project whose files fill the prompt (default: the Kural checkout this script is in)
  --think         let thinking models think (slower; Kural does this unless effort is "low")
  --skip-tab      chat only
  -o DIR          where results go               (default: ./bench-results/<date>-<model>)
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    -m) CHAT_MODEL="$2"; shift 2 ;;
    -t) TAB_MODEL="$2"; shift 2 ;;
    -c) CTX="$2"; shift 2 ;;
    -p) PROMPT_TOKENS="$2"; shift 2 ;;
    -r) CHAT_RUNS="$2"; shift 2 ;;
    -n) TAB_RUNS="$2"; shift 2 ;;
    -u) URL="${2%/}"; shift 2 ;;
    -o) OUT_DIR="$2"; shift 2 ;;
    --repo) REPO="$2"; shift 2 ;;
    --think) THINK=true; shift ;;
    --skip-tab) SKIP_TAB=true; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
done

# ---------- output helpers ----------
if [ -t 1 ]; then B=$'\033[1m'; G=$'\033[32m'; Y=$'\033[33m'; R=$'\033[31m'; D=$'\033[2m'; N=$'\033[0m'
else B=""; G=""; Y=""; R=""; D=""; N=""; fi
step() { printf '\n%s== %s%s\n' "$B" "$*" "$N"; }
info() { printf '   %s\n' "$*"; }
ok()   { printf '   %s%s%s\n' "$G" "$*" "$N"; }
warn() { printf '   %s%s%s\n' "$Y" "$*" "$N"; }
die()  { printf '\n%sError: %s%s\n' "$R" "$*" "$N" >&2; exit 1; }

# Float math through awk (bash only does integers).
calc() { awk "BEGIN { printf \"%.${2:-2}f\", $1 }"; }
# Median and 95th percentile of numbers on stdin.
median() { sort -n | awk '{ a[NR]=$1 } END { if (NR==0) { print "n/a"; exit } m = (NR%2) ? a[(NR+1)/2] : (a[NR/2]+a[NR/2+1])/2; printf "%.2f", m }'; }
p95()    { sort -n | awk '{ a[NR]=$1 } END { if (NR==0) { print "n/a"; exit } i = int(NR*0.95 + 0.999); if (i>NR) i=NR; printf "%.2f", a[i] }'; }

# ---------- preflight ----------
command -v curl >/dev/null || die "curl is missing."
command -v jq   >/dev/null || die "jq is missing. macOS 15+ has it built in; Ubuntu: sudo apt install jq; or: brew install jq"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if [ -z "$REPO" ]; then
  for c in "$SCRIPT_DIR/.." "$SCRIPT_DIR" "$PWD"; do
    if [ -d "$c/extension/lib" ]; then REPO="$(cd "$c" && pwd)"; break; fi
  done
fi
[ -n "$REPO" ] && [ -d "$REPO" ] || die "No project to build the prompt from. Run this from the Kural checkout or pass --repo DIR."

STAMP="$(date +%Y-%m-%d-%H%M)"
SAFE_MODEL="$(printf '%s' "$CHAT_MODEL" | tr -c 'A-Za-z0-9.' '-')"
OUT_DIR="${OUT_DIR:-$PWD/bench-results/$STAMP-$SAFE_MODEL}"
RAW="$OUT_DIR/raw"
mkdir -p "$RAW"

BG_PID=""
cleanup() { if [ -n "$BG_PID" ]; then kill "$BG_PID" 2>/dev/null || true; fi; }
trap cleanup EXIT INT TERM

if pgrep -fi "Kural.app/Contents/MacOS" >/dev/null 2>&1 || pgrep -x kural >/dev/null 2>&1; then
  warn "Kural is running. Its Tab Completion uses the same Ollama and will skew the numbers. Quit it for a clean run."
fi

step "Checking Ollama at $URL"
VERSION="$(curl -sS --max-time 3 "$URL/api/version" | jq -r '.version' 2>/dev/null)" \
  || die "Ollama doesn't answer at $URL. Is it running? (macOS: open the Ollama app; Linux: systemctl status ollama)"
ok "Ollama $VERSION"

TAGS="$(curl -sS --max-time 5 "$URL/api/tags")"
has_model() { printf '%s' "$TAGS" | jq -e --arg m "$1" '.models[] | select(.name == $m or .name == ($m + ":latest"))' >/dev/null; }
has_model "$CHAT_MODEL" || die "Chat model '$CHAT_MODEL' isn't downloaded. Installed: $(printf '%s' "$TAGS" | jq -r '[.models[].name] | join(", ")')"
if ! $SKIP_TAB && ! has_model "$TAB_MODEL"; then
  warn "Tab model '$TAB_MODEL' isn't downloaded: skipping the Tab tests. (ollama pull $TAB_MODEL)"
  SKIP_TAB=true
fi

SHOW="$(curl -sS -X POST "$URL/api/show" -d "$(jq -n --arg m "$CHAT_MODEL" '{model:$m}')")"
QUANT="$(printf '%s' "$SHOW" | jq -r '.details.quantization_level // "?"')"
PARAMS="$(printf '%s' "$SHOW" | jq -r '.details.parameter_size // "?"')"
FORMAT="$(printf '%s' "$SHOW" | jq -r '.details.format // "?"')"
CAN_THINK="$(printf '%s' "$SHOW" | jq -r '(.capabilities // []) | index("thinking") != null')"
CAN_TOOLS="$(printf '%s' "$SHOW" | jq -r '(.capabilities // []) | index("tools") != null')"
ok "$CHAT_MODEL: $PARAMS, $QUANT ($FORMAT), tools=$CAN_TOOLS, thinking=$CAN_THINK"
[ "$CAN_TOOLS" = "true" ] || warn "This model can't use tools, so Kural's chat wouldn't offer it. Measuring anyway."

# The computer
if [ "$(uname)" = "Darwin" ]; then
  CHIP="$(sysctl -n machdep.cpu.brand_string 2>/dev/null || echo '?')"
  MEM_GB="$(( $(sysctl -n hw.memsize) / 1024 / 1024 / 1024 ))"
  OS="macOS $(sw_vers -productVersion)"
else
  CHIP="$(awk -F: '/model name/ {print $2; exit}' /proc/cpuinfo | sed 's/^ *//')"
  MEM_GB="$(( $(awk '/MemTotal/ {print $2}' /proc/meminfo) / 1024 / 1024 ))"
  OS="$(. /etc/os-release 2>/dev/null && echo "$PRETTY_NAME" || uname -sr)"
fi
info "Computer: $CHIP, ${MEM_GB} GB, $OS"
swap_used() {
  if [ "$(uname)" = "Darwin" ]; then sysctl -n vm.swapusage | awk '{ for (i=1;i<=NF;i++) if ($i=="used") { print $(i+2); exit } }'
  else free -m | awk '/Swap/ { print $3 "M" }'; fi
}
SWAP_BEFORE="$(swap_used)"

# ---------- build the agent prompt (like engine.js: system prompt + tools + files the agent read) ----------
step "Building a ~$PROMPT_TOKENS-token agent prompt from $REPO"

# Kural's tool definitions (shape of lib/ai/tools.js), sent with every chat request.
cat > "$RAW/tools.json" <<'EOF'
[
 {"type":"function","function":{"name":"Read","description":"Read a text file. Returns lines with line numbers. For big files, read a part with offset/limit.","parameters":{"type":"object","properties":{"file_path":{"type":"string","description":"Path (relative to the project, or absolute)"},"offset":{"type":"integer","description":"First line to read (1-based)"},"limit":{"type":"integer","description":"How many lines"}},"required":["file_path"]}}},
 {"type":"function","function":{"name":"Write","description":"Create a file, or replace a whole file, with this content. For small changes to an existing file use Edit.","parameters":{"type":"object","properties":{"file_path":{"type":"string"},"content":{"type":"string"}},"required":["file_path","content"]}}},
 {"type":"function","function":{"name":"Edit","description":"Change a file: replace old_string (copied exactly from the file, with enough lines around it to be unique) with new_string.","parameters":{"type":"object","properties":{"file_path":{"type":"string"},"old_string":{"type":"string"},"new_string":{"type":"string"},"replace_all":{"type":"boolean","description":"Replace every match instead of exactly one"}},"required":["file_path","old_string","new_string"]}}},
 {"type":"function","function":{"name":"Glob","description":"Find files by name pattern, e.g. \"**/*.py\" or \"src/**/test_*.js\".","parameters":{"type":"object","properties":{"pattern":{"type":"string"},"path":{"type":"string","description":"Folder to look in (default: the project)"}},"required":["pattern"]}}},
 {"type":"function","function":{"name":"Grep","description":"Search the text of files with a regular expression. Returns file:line: text for each match.","parameters":{"type":"object","properties":{"pattern":{"type":"string"},"path":{"type":"string","description":"Folder or file (default: the project)"},"glob":{"type":"string","description":"Only files matching this, e.g. \"*.ts\""},"case_insensitive":{"type":"boolean"}},"required":["pattern"]}}},
 {"type":"function","function":{"name":"Bash","description":"Run a shell command in the project folder (tests, builds, git…). Returns its output and exit code.","parameters":{"type":"object","properties":{"command":{"type":"string"},"description":{"type":"string","description":"What it does, in a few words"}},"required":["command"]}}}
]
EOF

cat > "$RAW/system.txt" <<EOF
You are Kural, the AI assistant in the Kural code editor. You help the user with their software project.
Project folder: $REPO. Today is $(date +%Y-%m-%d).
Use your tools: look at files before you talk about them or change them; never guess what a file contains. Paths are relative to the project folder. To change a file, use Edit with old_string copied exactly from the file (Read it first), or Write for a new file. Run tests or commands with Bash when it helps. Keep answers short and clear; explain why before how.
EOF

# Files "the agent already read": source files, ~3.5 characters per token for code.
CHAR_BUDGET=$(( PROMPT_TOKENS * 35 / 10 ))
: > "$RAW/files.txt"
find "$REPO" -type f \( -name '*.js' -o -name '*.ts' -o -name '*.py' -o -name '*.vue' -o -name '*.sh' \) \
  -not -path '*/node_modules/*' -not -path '*/.git/*' -not -path '*/bench-results/*' -size -200k 2>/dev/null \
  | sort | while IFS= read -r f; do
      [ "$(wc -c < "$RAW/files.txt")" -ge "$CHAR_BUDGET" ] && break
      printf '\n--- %s ---\n' "${f#"$REPO"/}" >> "$RAW/files.txt"
      cat "$f" >> "$RAW/files.txt"
    done
head -c "$CHAR_BUDGET" "$RAW/files.txt" | iconv -f UTF-8 -t UTF-8 -c > "$RAW/files.cut.txt" 2>/dev/null || head -c "$CHAR_BUDGET" "$RAW/files.txt" > "$RAW/files.cut.txt"
info "$(wc -c < "$RAW/files.cut.txt" | tr -d ' ') characters of project files"

THINK_JSON="null"; [ "$CAN_THINK" = "true" ] && THINK_JSON="$THINK"

# messages file -> request body file
make_body() {  # $1 messages.json  $2 out.json
  jq -n --arg model "$CHAT_MODEL" --argjson ctx "$CTX" --argjson np "$ANSWER_TOKENS" --argjson think "$THINK_JSON" \
        --slurpfile tools "$RAW/tools.json" --slurpfile msgs "$1" \
    '{model:$model, stream:true, keep_alive:"30m", messages:$msgs[0], tools:$tools[0],
      options:{num_ctx:$ctx, num_predict:$np, temperature:0, seed:42}}
     + (if $think == null then {} else {think:$think} end)' > "$2"
}

# One streamed /api/chat request. Prints: ttft_s total_s prompt_n prompt_s gen_n gen_s load_s
# (ttft = first streamed byte = the moment Kural can show the first word)
chat() {  # $1 body.json  $2 name (raw files)
  local out="$RAW/$2.ndjson" timing
  timing="$(curl -sS -N --max-time 900 -X POST "$URL/api/chat" -H 'Content-Type: application/json' \
            --data-binary @"$1" -o "$out" -w '%{http_code} %{time_starttransfer} %{time_total}')" \
    || die "Request $2 failed (curl). See $out"
  set -- $timing "$2"
  [ "$1" = "200" ] || die "Ollama answered HTTP $1 for $4: $(head -c 300 "$out")"
  local last; last="$(jq -c 'select(.done == true)' "$out" 2>/dev/null | tail -1)"
  [ -n "$last" ] || die "No final stats in $out (stopped early?)"
  # The answer, as one assistant message (for the follow-up turn)
  jq -s '{role:"assistant", content: (map(.message.content // "") | join("")),
          tool_calls: (map(.message.tool_calls // []) | add)} | if (.tool_calls|length)==0 then del(.tool_calls) else . end' \
     "$out" > "$RAW/$4.answer.json"
  printf '%s' "$last" | jq -r --arg ttft "$2" --arg total "$3" \
    '"\($ttft) \($total) \(.prompt_eval_count // 0) \((.prompt_eval_duration // 0)/1e9) \(.eval_count // 0) \((.eval_duration // 0)/1e9) \((.load_duration // 0)/1e9)"'
}

unload() { curl -sS -X POST "$URL/api/generate" -d "$(jq -n --arg m "$1" '{model:$m, keep_alive:0}')" >/dev/null || true; }

# A fresh agent conversation. The nonce at the start makes every run a cache miss (a new chat in Kural).
fresh_messages() {  # $1 nonce  $2 out.json
  jq -n --rawfile sys "$RAW/system.txt" --rawfile files "$RAW/files.cut.txt" --arg nonce "$1" \
    '[{role:"system", content: ("Session " + $nonce + ".\n" + $sys)},
      {role:"user", content: ("Here are the files you read so far:\n" + $files +
        "\n\nQuestion: in a few sentences, what does this code do, and what is the riskiest part to change? Answer in plain text; do not call tools.")}]' > "$2"
}

# ---------- 0. first load ----------
step "0. Loading the chat model from disk (what the first chat after a long pause waits for)"
unload "$CHAT_MODEL"; $SKIP_TAB || unload "$TAB_MODEL"; sleep 2
jq -n '[{role:"user", content:"hi"}]' > "$RAW/warm.msgs.json"
make_body "$RAW/warm.msgs.json" "$RAW/warm.body.json"
RES="$(chat "$RAW/warm.body.json" warm)"   # a plain assignment, so set -e stops the script if chat fails
read -r _ _ _ _ _ _ LOAD_S <<< "$RES"
ok "Loaded in $(calc "$LOAD_S" 1) s (num_ctx $CTX)"

# ---------- 1. chat, first answer ----------
step "1. Chat, first answer: fresh agent turn ($CHAT_RUNS runs)"
: > "$RAW/s1.txt"
i=1
while [ "$i" -le "$CHAT_RUNS" ]; do
  fresh_messages "$STAMP-$i-$RANDOM" "$RAW/s1-$i.msgs.json"
  make_body "$RAW/s1-$i.msgs.json" "$RAW/s1-$i.body.json"
  RES="$(chat "$RAW/s1-$i.body.json" "s1-$i")"
  read -r TTFT TOTAL PN PS GN GS _ <<< "$RES"
  echo "$TTFT $TOTAL $PN $PS $GN $GS" >> "$RAW/s1.txt"
  info "run $i: first word after $(calc "$TTFT" 1) s · read $PN tokens at $(calc "$PN/($PS+1e-9)" 0) tok/s · wrote $GN at $(calc "$GN/($GS+1e-9)" 1) tok/s"
  i=$((i+1))
done
S1_TTFT="$(awk '{print $1}' "$RAW/s1.txt" | median)"
S1_PN="$(awk '{print $3}' "$RAW/s1.txt" | median)"
S1_PP="$(awk '{print $3/($4+1e-9)}' "$RAW/s1.txt" | median)"
S1_TG="$(awk '{print $5/($6+1e-9)}' "$RAW/s1.txt" | median)"

# ---------- 2. chat, follow-up (cache reuse) ----------
step "2. Chat, follow-up in the same conversation (does the engine reuse its cache?)"
LAST="$CHAT_RUNS"
jq --slurpfile a "$RAW/s1-$LAST.answer.json" \
   '. + [$a[0], {role:"user", content:"Thanks. Which single function would you add a unit test for first, and why? One paragraph, no tools."}]' \
   "$RAW/s1-$LAST.msgs.json" > "$RAW/s2.msgs.json"
make_body "$RAW/s2.msgs.json" "$RAW/s2.body.json"
RES="$(chat "$RAW/s2.body.json" s2)"
read -r S2_TTFT _ S2_PN S2_PS S2_GN S2_GS _ <<< "$RES"
S1_LAST_PN="$(tail -1 "$RAW/s1.txt" | awk '{print $3}')"
S1_LAST_GN="$(tail -1 "$RAW/s1.txt" | awk '{print $5}')"
S2_HISTORY=$(( S1_LAST_PN + S1_LAST_GN + 40 ))   # roughly: what the conversation holds now
S2_REREAD_PCT="$(calc "100*$S2_PN/$S2_HISTORY" 0)"
info "first word after $(calc "$S2_TTFT" 1) s · engine read $S2_PN of ~$S2_HISTORY tokens ($S2_REREAD_PCT %)"
if [ "$S2_REREAD_PCT" -le 20 ]; then CACHE="reused"; ok "Cache reused: only the new message was read."
elif [ "$S2_REREAD_PCT" -le 70 ]; then CACHE="partly"; warn "Cache partly reused."
else CACHE="not reused"; warn "Cache NOT reused: the whole history was read again. Every agent step pays the full prompt."; fi

# ---------- 3 + 4. Tab Completion ----------
TAB_P50="n/a"; TAB_P95="n/a"; TABC_P50="n/a"; TABC_P95="n/a"; TABC_FAILS=0; BOTH_LOADED="n/a"
if ! $SKIP_TAB; then
  # Real code around a cursor: the middle of a project file.
  SRC="$(find "$REPO" -type f -name '*.js' -not -path '*/node_modules/*' -size +4k -size -60k 2>/dev/null | sort | head -1)"
  [ -n "$SRC" ] || SRC="$RAW/files.cut.txt"
  LINES="$(wc -l < "$SRC" | tr -d ' ')"; CUT=$(( LINES / 2 ))
  head -n "$CUT" "$SRC" | tail -n 80 > "$RAW/fim.prefix.txt"
  tail -n +"$(( CUT + 1 ))" "$SRC" | head -n 40 > "$RAW/fim.suffix.txt"

  fim() {  # $1 extra chars typed  $2 out.txt -> prints seconds (wall clock) or "fail"
    local body; body="$(jq -n --arg model "$TAB_MODEL" --rawfile pre "$RAW/fim.prefix.txt" --rawfile suf "$RAW/fim.suffix.txt" --arg typed "$1" \
      '{model:$model, raw:true, stream:false, keep_alive:"30m",
        prompt: ("<|fim_prefix|>" + $pre + $typed + "<|fim_suffix|>" + $suf + "<|fim_middle|>"),
        options:{temperature:0, num_predict:64, stop:["<|endoftext|>","<|fim_pad|>","<|file_sep|>","<|fim_prefix|>","<|fim_suffix|>","<|fim_middle|>","\n\n\n"]}}')"
    curl -sS --max-time 6 -X POST "$URL/api/generate" -H 'Content-Type: application/json' -d "$body" -o "$2" -w '%{time_total}' 2>/dev/null || echo fail
  }
  # Each suggestion = one more character typed (like real typing: the prefix grows).
  TYPED="  const result = await "
  tab_runs() {  # $1 label -> appends seconds to $RAW/$1.txt
    : > "$RAW/$1.txt"; local k=1 s
    while [ "$k" -le "$TAB_RUNS" ]; do
      s="$(fim "${TYPED:0:$k}" "$RAW/$1-$k.json")"
      echo "$s" >> "$RAW/$1.txt"; k=$((k+1))
    done
  }

  step "3. Tab Completion alone ($TAB_RUNS suggestions, $TAB_MODEL)"
  fim "" "$RAW/tab-warm.json" >/dev/null   # load it (Kural warms it up the same way)
  tab_runs tab
  TAB_P50="$(grep -v fail "$RAW/tab.txt" | awk '{print $1*1000}' | median)"
  TAB_P95="$(grep -v fail "$RAW/tab.txt" | awk '{print $1*1000}' | p95)"
  info "median ${TAB_P50} ms · 95th percentile ${TAB_P95} ms"

  step "4. Tab Completion while a chat answers (one GPU for both)"
  fresh_messages "$STAMP-bg-$RANDOM" "$RAW/s4.msgs.json"
  make_body "$RAW/s4.msgs.json" "$RAW/s4.body.json"
  ( chat "$RAW/s4.body.json" s4 > "$RAW/s4.result.txt" ) &
  BG_PID=$!
  sleep 1
  BOTH_LOADED="$(curl -sS "$URL/api/ps" | jq --arg a "$CHAT_MODEL" --arg b "$TAB_MODEL" \
    '[.models[].name] | (any(. == $a or . == ($a+":latest"))) and (any(. == $b or . == ($b+":latest")))')"
  tab_runs tabc
  wait "$BG_PID" || true; BG_PID=""
  TABC_FAILS="$(grep -c fail "$RAW/tabc.txt" || true)"
  TABC_P50="$(grep -v fail "$RAW/tabc.txt" | awk '{print $1*1000}' | median)"
  TABC_P95="$(grep -v fail "$RAW/tabc.txt" | awk '{print $1*1000}' | p95)"
  info "median ${TABC_P50} ms · 95th percentile ${TABC_P95} ms · gave up (>6 s, like Kural): $TABC_FAILS of $TAB_RUNS"
  info "both models loaded at once: $BOTH_LOADED"
  [ -s "$RAW/s4.result.txt" ] && info "the chat meanwhile: first word after $(calc "$(awk '{print $1}' "$RAW/s4.result.txt")" 1) s"
fi

# ---------- memory ----------
step "Memory"
curl -sS "$URL/api/ps" > "$RAW/ps.json"
jq -r '.models[] | "   \(.name): \((.size/1e9*10|round)/10) GB (on GPU \((.size_vram/1e9*10|round)/10) GB)\(if .context_length then ", context \(.context_length)" else "" end)"' "$RAW/ps.json"
CHAT_GB="$(jq -r --arg m "$CHAT_MODEL" '[.models[] | select(.name==$m or .name==($m+":latest")) | .size][0] // 0 | ./1e9*10 | round/10' "$RAW/ps.json")"
SWAP_AFTER="$(swap_used)"
info "swap used: $SWAP_BEFORE before, $SWAP_AFTER after"

# ---------- what it means for Kural ----------
verdict() {  # $1 value  $2 good-below  $3 ok-below
  awk -v v="$1" -v g="$2" -v o="$3" 'BEGIN { if (v=="n/a") print "-"; else if (v+0 < g) print "good"; else if (v+0 < o) print "usable"; else print "slow" }'
}
REPLY_S="$(calc "300/($S1_TG+1e-9)" 1)"
step "What this means for Kural  ($CHAT_MODEL $QUANT, ctx $CTX, Ollama $VERSION, ${MEM_GB} GB)"
printf '   %-34s %-28s %s\n' "Kural feature" "Measured" "Feels"
printf '   %-34s %-28s %s\n' "----------------------------------" "----------------------------" "------"
printf '   %-34s %-28s %s\n' "Chat: wait for first word (new)" "$(calc "$S1_TTFT" 1) s for $(calc "$S1_PN" 0) tokens" "$(verdict "$S1_TTFT" 3 10)"
printf '   %-34s %-28s %s\n' "Chat: reading speed (prefill)" "$(calc "$S1_PP" 0) tok/s" "$(verdict "$(calc "-$S1_PP" 0)" -1500 -500)"
printf '   %-34s %-28s %s\n' "Chat: writing speed" "$(calc "$S1_TG" 1) tok/s (300 tok: ${REPLY_S} s)" "$(verdict "$(calc "-$S1_TG" 1)" -30 -12)"
printf '   %-34s %-28s %s\n' "Chat: follow-up / each agent step" "$(calc "$S2_TTFT" 1) s, cache $CACHE" "$(verdict "$S2_TTFT" 2 8)"
printf '   %-34s %-28s %s\n' "Tab Completion (alone)" "${TAB_P50} ms (p95 ${TAB_P95})" "$(verdict "$TAB_P50" 300 800)"
printf '   %-34s %-28s %s\n' "Tab Completion (during a chat)" "${TABC_P50} ms, $TABC_FAILS gave up" "$(verdict "$TABC_P50" 300 800)"
printf '   %-34s %-28s %s\n' "Chat + Tab models fit together" "$BOTH_LOADED (chat ${CHAT_GB} GB)" ""
echo
info "${D}An agent task is several steps (read, edit, run tests): multiply the follow-up wait by the steps.${N}"
info "${D}Thresholds: chat first word <3 s good, <10 s usable; Tab <300 ms feels instant, >800 ms is mostly ignored.${N}"

# ---------- save ----------
jq -n \
  --arg date "$STAMP" --arg engine "ollama" --arg version "$VERSION" --arg chip "$CHIP" --argjson mem "$MEM_GB" --arg os "$OS" \
  --arg model "$CHAT_MODEL" --arg quant "$QUANT" --arg params "$PARAMS" --argjson ctx "$CTX" --arg think "$THINK_JSON" \
  --argjson load "$LOAD_S" --argjson ttft "$S1_TTFT" --argjson pn "$S1_PN" --argjson pp "$S1_PP" --argjson tg "$S1_TG" \
  --argjson ttft2 "$S2_TTFT" --argjson pn2 "$S2_PN" --argjson hist2 "$S2_HISTORY" --arg cache "$CACHE" \
  --arg tabm "$TAB_MODEL" --arg tab50 "$TAB_P50" --arg tab95 "$TAB_P95" --arg tabc50 "$TABC_P50" --arg tabc95 "$TABC_P95" \
  --argjson tabcf "${TABC_FAILS:-0}" --arg both "$BOTH_LOADED" --argjson chatgb "$CHAT_GB" --arg swap0 "$SWAP_BEFORE" --arg swap1 "$SWAP_AFTER" \
  '{date:$date, engine:$engine, engine_version:$version, computer:{chip:$chip, memory_gb:$mem, os:$os},
    chat:{model:$model, quant:$quant, params:$params, num_ctx:$ctx, think:$think, load_s:$load,
          first_answer:{ttft_s:$ttft, prompt_tokens:$pn, prefill_tok_s:$pp, gen_tok_s:$tg},
          follow_up:{ttft_s:$ttft2, prompt_tokens_read:$pn2, history_tokens_approx:$hist2, cache:$cache},
          memory_gb:$chatgb},
    tab:{model:$tabm, alone_ms:{p50:$tab50, p95:$tab95}, during_chat_ms:{p50:$tabc50, p95:$tabc95, gave_up:$tabcf}, both_loaded:$both},
    swap:{before:$swap0, after:$swap1}}' > "$OUT_DIR/results.json"

echo
ok "Saved: $OUT_DIR/results.json  (raw requests and answers in $OUT_DIR/raw)"

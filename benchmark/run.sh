#!/usr/bin/env bash
# Kural engine benchmark: one command measures every engine Kural could use on this computer, on Kural's real
# workloads, and ends with a comparison report. macOS (Apple Silicon) and Linux.
#
#   benchmark/run.sh                          every engine that fits this computer (config.sh: ENGINES="auto")
#   benchmark/run.sh --quick                  fewer runs: a first look
#   benchmark/run.sh --engines "ollama llamacpp-vulkan"
#   benchmark/run.sh --profiles helpers       only what every Kural user runs (Tab Completion + Model Router)
#   benchmark/run.sh --yes                    don't ask before downloading
#
# Two profiles (see config.sh): "helpers" = Tab Completion and Model Router's embedding helper, which every Kural user
# runs locally even with Claude/ChatGPT/Gemini for the chat; "chat" = "your own model" as the chat.
#
# Everything it installs stays inside benchmark/ (delete .tools .venv* .cache to remove it):
#   .tools/   llama.cpp builds (GitHub releases), uv + Python      .venv/ mlx-lm (Mac)    .venv-vllm/ vLLM (Linux)
#   .cache/   model files and download caches                       results/<run>/  <engine>.json, logs, report.html
# Outside benchmark/: missing Ollama models are pulled into Ollama (as Kural's own setup does).
#
# Needs: curl, git, perl, tar (built in on macOS and Ubuntu) and Node 18+.

set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
# shellcheck source=config.sh
. "$HERE/config.sh"

YES=false
while [ $# -gt 0 ]; do
  case "$1" in
    -y|--yes) YES=true; shift ;;
    --quick) CHAT_RUNS=1; TAB_RUNS=5; COOLDOWN_S=10; IDLE_S=5; shift ;;
    --engines) ENGINES="$2"; shift 2 ;;
    --profiles) PROFILES="$2"; shift 2 ;;
    --think) THINK=true; shift ;;
    -h|--help) sed -n '2,21p' "$0"; exit 0 ;;
    *) echo "Unknown option: $1 (try --help)" >&2; exit 2 ;;
  esac
done

OS_NAME="$(uname -s)"; ARCH="$(uname -m)"
IS_MAC_ARM=false; [ "$OS_NAME" = "Darwin" ] && [ "$ARCH" = "arm64" ] && IS_MAC_ARM=true
IS_LINUX=false; [ "$OS_NAME" = "Linux" ] && IS_LINUX=true
HAS_NVIDIA=false; command -v nvidia-smi >/dev/null 2>&1 && nvidia-smi -L >/dev/null 2>&1 && HAS_NVIDIA=true

TOOLS="$HERE/.tools"; CACHE="$HERE/.cache"
RUN_ID="$(date +%Y-%m-%d-%H%M%S)"
OUT="$HERE/results/$RUN_ID"
mkdir -p "$TOOLS" "$CACHE" "$OUT"
exec > >(tee -a "$OUT/run.log") 2>&1   # everything on screen also goes to run.log

# ------------------------------------------------------------------ output helpers
if [ -t 1 ] || [ -t 0 ]; then B=$'\033[1m'; G=$'\033[32m'; Y=$'\033[33m'; R=$'\033[31m'; N=$'\033[0m'; else B=""; G=""; Y=""; R=""; N=""; fi
step() { printf '\n%s== %s%s\n' "$B" "$*" "$N"; }
info() { printf '   %s\n' "$*"; }
ok()   { printf '   %s%s%s\n' "$G" "$*" "$N"; }
warn() { printf '   %s%s%s\n' "$Y" "$*" "$N"; }
die()  { printf '   %sError: %s%s\n' "$R" "$*" "$N" >&2; exit 1; }   # stderr: also seen from inside $( )
now()  { perl -MTime::HiRes=time -e 'printf "%.2f\n", time'; }
since() { perl -e "printf '%.1f', $(now) - $1"; }
has_word() { case " $1 " in *" $2 "*) return 0 ;; *) return 1 ;; esac; }

# ------------------------------------------------------------------ Node (Kural's own Electron works as Node too)
NODE_BIN=""; ELECTRON_BIN=""
if command -v node >/dev/null 2>&1 && node -e 'process.exit(+process.versions.node.split(".")[0] >= 18 ? 0 : 1)' 2>/dev/null; then
  NODE_BIN="$(command -v node)"
else
  for app in /Applications/Kural.app/Contents/MacOS "$HOME/Applications/Kural.app/Contents/MacOS"; do
    if [ -d "$app" ]; then ELECTRON_BIN="$app/$(ls "$app" | head -1)"; break; fi
  done
  [ -n "$ELECTRON_BIN" ] || die "Node 18+ is needed (macOS: brew install node; Ubuntu 24.04: sudo apt install nodejs; or https://nodejs.org)."
fi
js() { if [ -n "$NODE_BIN" ]; then "$NODE_BIN" "$@"; else ELECTRON_RUN_AS_NODE=1 "$ELECTRON_BIN" "$@"; fi; }
BENCH="$HERE/lib/bench.js"
setj() { js "$BENCH" set "$@"; }   # setj file key=value …
# JSON on stdin -> one value per line, e.g.  curl … | jget 'd.models.map(m => m.name)'
jget() { js -e "let s='';process.stdin.on('data',c=>s+=c).on('end',()=>{let d;try{d=JSON.parse(s)}catch{process.exit(1)}const v=($1);for(const x of [].concat(v??[]))console.log(x)})"; }

http_ok() { curl -sf -m 2 "$1" >/dev/null 2>&1; }
swap_used() {
  if [ "$OS_NAME" = "Darwin" ]; then sysctl -n vm.swapusage | awk '{ for (i=1;i<=NF;i++) if ($i=="used") { print $(i+2); exit } }'
  else free -m | awk '/Swap/ { print $3 "M" }'; fi
}

# ------------------------------------------------------------------ measuring processes
# A process and all its children (vLLM, for one, runs the model in a child process).
tree_pids() {
  local p c
  for p in "$@"; do
    echo "$p"
    for c in $(pgrep -P "$p" 2>/dev/null || true); do tree_pids "$c"; done
  done
}
# "RAM_GB VRAM_GB" of these processes. RAM: the larger of resident memory (counts model files mapped into memory,
# like llama.cpp's) and, on macOS, footprint (counts GPU memory, like MLX's). VRAM: NVIDIA's own count per process.
mem_of() {
  local kb=0 pid r f vram_mb=0
  for pid in "$@"; do
    r="$(ps -o rss= -p "$pid" 2>/dev/null | tr -d ' ' || true)"; r="${r:-0}"; f=0
    if [ "$OS_NAME" = "Darwin" ] && command -v footprint >/dev/null 2>&1; then
      f="$(footprint -p "$pid" 2>/dev/null | perl -ne 'if (/Footprint:\s*([\d.]+)\s*([KMG])B/) { print int($1 * {K=>1, M=>1024, G=>1048576}->{$2}); exit }' || true)"; f="${f:-0}"
    fi
    [ "$f" -gt "$r" ] && r="$f"
    kb=$((kb + r))
  done
  if $HAS_NVIDIA; then
    local list; list=" $* "
    vram_mb="$(nvidia-smi --query-compute-apps=pid,used_memory --format=csv,noheader,nounits 2>/dev/null \
      | awk -F', *' -v l="$list" 'index(l, " " $1 " ") { s += $2 } END { print s + 0 }')"
  fi
  perl -e "printf '%.2f %.2f', $kb / 1048576, $vram_mb / 1024"
}
# CPU use of these processes while nothing is asked of them, in % of one core (Linux: exact, from /proc).
cpu_idle() {  # seconds pids...
  local secs="$1"; shift
  if $IS_LINUX; then
    local hz t0 t1; hz="$(getconf CLK_TCK)"
    t0="$(for p in "$@"; do awk '{ print $14 + $15 }' "/proc/$p/stat" 2>/dev/null || true; done | awk '{ s += $1 } END { print s + 0 }')"
    sleep "$secs"
    t1="$(for p in "$@"; do awk '{ print $14 + $15 }' "/proc/$p/stat" 2>/dev/null || true; done | awk '{ s += $1 } END { print s + 0 }')"
    perl -e "printf '%.1f', ($t1 - $t0) / $hz / $secs * 100"
  else
    sleep "$secs"; ps -o %cpu= -p "$(echo "$@" | tr ' ' ',')" 2>/dev/null | awk '{ s += $1 } END { printf "%.1f", s }'
  fi
}
size_mb() { du -sk "$@" 2>/dev/null | awk '{ s += $1 } END { printf "%d", s / 1024 }'; }

# Start a server in the background (log in the run folder). Prints its PID.
start_server() {  # name, then the command
  local name="$1"; shift
  "$@" > "$OUT/$name.log" 2>&1 &
  echo $!
}
wait_ready() {  # url pid name seconds
  local i=0
  while ! http_ok "$1"; do
    kill -0 "$2" 2>/dev/null || { tail -n 15 "$OUT/$3.log" | sed 's/^/      | /' >&2; die "$3 stopped while starting (log: results/$RUN_ID/$3.log)"; }
    i=$((i + 1)); [ "$i" -le "$4" ] || die "$3 didn't get ready in $4 s (log: results/$RUN_ID/$3.log)"
    sleep 1
  done
}

# Free Ollama's models, so the engine being measured has the memory (and GPU) to itself.
ollama_unload_all() {
  http_ok "$OLLAMA_URL/api/version" || return 0
  local m
  for m in $(curl -sS "$OLLAMA_URL/api/ps" | jget 'd.models.map(m => m.name)' || true); do
    curl -sS -X POST "$OLLAMA_URL/api/generate" -d "{\"model\":\"$m\",\"keep_alive\":0}" >/dev/null || true
  done
  sleep 2
}

# The newest GitHub release that has a file matching the pattern -> "tag url". Not /releases/latest: llama.cpp marks
# its binary builds (b11505, …) as pre-releases, and its "latest" release has no binaries at all.
gh_asset() {  # owner/repo regex
  curl -fsSL "https://api.github.com/repos/$1/releases?per_page=30" \
    | jget "(() => { for (const r of d) { const a = (r.assets || []).find(a => new RegExp('$2').test(a.name)); if (a) return r.tag_name + ' ' + a.browser_download_url } return null })()"
}
fetch_extract() {  # url dir
  local file="$CACHE/$(basename "$1")"
  curl -fL --progress-bar -o "$file" "$1"
  mkdir -p "$2"
  case "$file" in *.zip) unzip -q -o "$file" -d "$2" ;; *) tar -xzf "$file" -C "$2" ;; esac
  rm -f "$file"
}

# ------------------------------------------------------------------ installers (each skips what's already there)
# llama.cpp: one folder per build (metal, cuda, vulkan, cpu). Prints the path of llama-server.
install_llamacpp() {  # variant
  local v="$1" dir="$TOOLS/llama.cpp-$1" bin pattern extra="" found cv
  bin="$(find "$dir" -name llama-server -type f 2>/dev/null | head -1)"
  if [ -n "$bin" ]; then echo "$bin"; return; fi
  case "$v" in
    metal) $IS_MAC_ARM || die "the Metal build is for Apple Silicon Macs"; pattern='^llama-.*-bin-macos-arm64\\.(zip|tar\\.gz)$' ;;
    cpu) if $IS_MAC_ARM; then pattern='^llama-.*-bin-macos-arm64\\.(zip|tar\\.gz)$'; else pattern='^llama-.*-bin-ubuntu-x64\\.(zip|tar\\.gz)$'; fi ;;
    vulkan) $IS_LINUX || die "the Vulkan build is measured on Linux"
            pattern='^llama-.*-bin-ubuntu-vulkan-x64\\.(zip|tar\\.gz)$' ;;
    cuda) $HAS_NVIDIA || die "no NVIDIA GPU (nvidia-smi) on this computer"
          # The newest CUDA the driver supports decides the build: 13.x drivers take the 13.4 build, older the 12.8 one.
          cv="$(nvidia-smi | grep -o 'CUDA Version: [0-9.]*' | awk '{ print $3 }')"
          if awk -v c="${cv:-0}" 'BEGIN { exit !(c >= 13.4) }'; then cv="13\\.4"; else cv="12\\.8"; fi
          pattern="^llama-.*-bin-ubuntu-cuda-$cv-x64\\.tar\\.gz\$"; extra="^cudart-llama-.*-bin-ubuntu-cuda-$cv-x64\\.tar\\.gz\$" ;;
    *) die "unknown llama.cpp build '$v'" ;;
  esac
  info "Downloading llama.cpp ($v build, github.com/ggml-org/llama.cpp)…" >&2
  found="$(gh_asset ggml-org/llama.cpp "$pattern")" || die "GitHub didn't answer (offline, or its limit of 60 requests an hour: try again later)"
  if [ -z "$found" ] && [ "$v" = "metal" ] && command -v brew >/dev/null 2>&1; then
    warn "No download on GitHub; installing llama.cpp with Homebrew instead." >&2
    brew install llama.cpp >&2 && command -v llama-server && return
  fi
  [ -n "$found" ] || die "no llama.cpp release on GitHub has a file matching $pattern"
  fetch_extract "${found#* }" "$dir" >&2
  if [ -n "$extra" ]; then   # the CUDA runtime libraries, next to the program
    found="$(gh_asset ggml-org/llama.cpp "$extra")" || true
    [ -n "$found" ] && fetch_extract "${found#* }" "$(dirname "$(find "$dir" -name llama-server -type f | head -1)")" >&2
  fi
  bin="$(find "$dir" -name llama-server -type f | head -1)"
  [ -n "$bin" ] || die "llama-server not found in the llama.cpp download"
  chmod +x "$bin"
  ok "llama.cpp ${found%% *} ($v) installed in benchmark/.tools" >&2
  echo "$bin"
}

# One GGUF file from Hugging Face (resumes a broken download). Prints its path. A repo that doesn't exist is searched
# for by name (most downloaded first). quants: preferences, first found wins ("Q8_0 F16").
hf_gguf() {  # repo quants
  local repo="$1" quants="$2" tree pick q name size dir have
  tree="$(curl -fsSL "https://huggingface.co/api/models/$repo/tree/main" 2>/dev/null || true)"
  if [ -z "$tree" ]; then
    local found; found="$(curl -fsSL "https://huggingface.co/api/models?search=$(basename "$repo" | sed 's/-GGUF$//I')&filter=gguf&sort=downloads&limit=1" | jget 'd.map(m => m.id)' | head -1 || true)"
    [ -n "$found" ] || die "Hugging Face has no '$repo' and nothing like it. Change it in benchmark/config.sh."
    info "'$repo' not found; using $found" >&2
    repo="$found"; tree="$(curl -fsSL "https://huggingface.co/api/models/$repo/tree/main")"
  fi
  for q in $quants; do
    pick="$(printf '%s' "$tree" | jget "d.filter(f => /\\.gguf\$/i.test(f.path) && !/mmproj/i.test(f.path) && f.path.toUpperCase().includes('$q'.toUpperCase())).sort((a,b) => a.size - b.size).slice(0,1).map(f => f.path + ' ' + f.size)" || true)"
    [ -n "$pick" ] && break
  done
  [ -n "$pick" ] || die "no $quants .gguf file in $repo. Change the quantization or the repo in benchmark/config.sh."
  name="${pick% *}"; size="${pick##* }"
  dir="$CACHE/gguf/$(printf '%s' "$repo" | tr '/' '_')"; mkdir -p "$dir"
  have="$(stat -f %z "$dir/$(basename "$name")" 2>/dev/null || stat -c %s "$dir/$(basename "$name")" 2>/dev/null || echo 0)"
  if [ "$have" != "$size" ]; then
    info "Downloading $repo/$name ($(perl -e "printf '%.2f', $size/1e9") GB)…" >&2
    curl -fL -C - --progress-bar -o "$dir/$(basename "$name")" "https://huggingface.co/$repo/resolve/main/$name" >&2
  fi
  echo "$dir/$(basename "$name")"
}

UV=""
install_uv() {
  [ -n "$UV" ] && return 0
  if command -v uv >/dev/null 2>&1; then UV="$(command -v uv)"; return 0; fi
  UV="$(find "$TOOLS/uv" -name uv -type f 2>/dev/null | head -1)"; [ -n "$UV" ] && return 0
  local asset found
  if $IS_MAC_ARM; then asset='uv-aarch64-apple-darwin\\.tar\\.gz$'; else asset='uv-x86_64-unknown-linux-gnu\\.tar\\.gz$'; fi
  info "Downloading uv (Python installer, github.com/astral-sh/uv)…"
  found="$(gh_asset astral-sh/uv "$asset")" || die "GitHub didn't answer (offline, or rate-limited: try again later)"
  [ -n "$found" ] || die "no uv release on GitHub for this computer"
  fetch_extract "${found#* }" "$TOOLS/uv"
  UV="$(find "$TOOLS/uv" -name uv -type f | head -1)"; chmod +x "$UV"
}
py_env() {  # venv packages… : a Python 3.12 environment with these packages
  local venv="$1"; shift
  export UV_CACHE_DIR="$CACHE/uv" UV_PYTHON_INSTALL_DIR="$TOOLS/python" HF_HOME="$CACHE/hf"
  install_uv
  [ -x "$venv/bin/python" ] || "$UV" venv --quiet --python 3.12 "$venv"
  info "Installing $* into benchmark/$(basename "$venv") (once)…"
  "$UV" pip install --quiet --python "$venv/bin/python" "$@"
}
hf_snapshot() {  # venv repo
  HF_HOME="$CACHE/hf" "$1/bin/python" -c "import sys; from huggingface_hub import snapshot_download; snapshot_download(sys.argv[1])" "$2" \
    || die "couldn't download $2 from Hugging Face. Check the name in benchmark/config.sh."
}

# ------------------------------------------------------------------ shared steps of every engine
run_helpers() { has_word "$PROFILES" helpers; }
run_chat() {  # cpu?  (the -cpu engines only with CHAT_ON_CPU=true)
  has_word "$PROFILES" chat || return 1
  [ "$1" = "cpu" ] && [ "$CHAT_ON_CPU" != "true" ] && return 1
  return 0
}
bench() { js "$BENCH" run --ctx "$CTX" --prompt-tokens "$PROMPT_TOKENS" --runs "$CHAT_RUNS" --tab-runs "$TAB_RUNS" \
  --answer-tokens "$ANSWER_TOKENS" --repo "$REPO" $($THINK && echo --think) "$@"; }
# After the helpers profile: what the engine costs while you just type and nothing is asked of it.
idle_cost() {  # file pids…
  local f="$1"; shift
  info "Measuring idle cost for ${IDLE_S} s (memory, CPU)…"
  local cpu mem; cpu="$(cpu_idle "$IDLE_S" "$@")"; mem="$(mem_of "$@")"
  setj "$f" "helpers_ram_gb=${mem% *}" "helpers_vram_gb=${mem#* }" "idle_cpu_pct=$cpu"
  info "idle: ${mem% *} GB memory, ${mem#* } GB GPU memory, ${cpu} % of one core"
}

# ------------------------------------------------------------------ engines (each runs in a subshell: its servers stop with it)
record() { echo "$OUT/$1.json"; }
skip_engine() {  # id label order reason
  setj "$(record "$1")" "id=$1" "engine=$2" "order=$3" "skipped=$4"
  warn "Skipped $2: $4"
}

ollama_pids() { pgrep -f 'ollama (serve|runner)' 2>/dev/null | tr '\n' ' '; }
engine_ollama() {  # id label order variant(gpu|cpu|mlx)
  local id="$1" label="$2" order="$3" v="$4" f opts="{}" chat="$OLLAMA_CHAT"; f="$(record "$id")"
  [ "$v" = "cpu" ] && opts="{\"num_gpu\":0,\"num_thread\":$LIGHT_THREADS}"
  [ "$v" = "mlx" ] && chat="$OLLAMA_MLX_CHAT"
  if ! http_ok "$OLLAMA_URL/api/version"; then
    if $IS_MAC_ARM && [ -d /Applications/Ollama.app ]; then info "Starting Ollama…"; open -a Ollama; sleep 8; fi
    http_ok "$OLLAMA_URL/api/version" || die "Ollama isn't running at $OLLAMA_URL (install: https://ollama.com; Linux: sudo systemctl start ollama)"
  fi
  local version m models="$OLLAMA_TAB $OLLAMA_EMBED"
  version="$(curl -sS "$OLLAMA_URL/api/version" | jget 'd.version')"
  run_chat "$v" && models="$models $chat"
  for m in $models; do
    if ! curl -sS "$OLLAMA_URL/api/tags" | jget "d.models.map(m => m.name)" | grep -qxF -e "$m" -e "$m:latest"; then
      info "Pulling $m into Ollama…"
      if command -v ollama >/dev/null 2>&1; then ollama pull "$m" || die "couldn't pull $m"
      else curl -fsS -X POST "$OLLAMA_URL/api/pull" -d "{\"model\":\"$m\",\"stream\":false}" >/dev/null || die "couldn't pull $m"; fi
    fi
  done
  local olbin; olbin="$(command -v ollama 2>/dev/null || true)"
  setj "$f" "id=$id" "order=$order" "version=Ollama $version" "variant=$v" \
    "install_mb=$( [ -n "$olbin" ] && size_mb "$(readlink -f "$olbin" 2>/dev/null || echo "$olbin")" "$(dirname "$(dirname "$(readlink -f "$olbin" 2>/dev/null || echo "$olbin")")")/lib/ollama" || echo '')"
  ollama_unload_all
  local t0
  if run_helpers; then
    t0="$(now)"
    js "$BENCH" warm --protocol ollama --url "$OLLAMA_URL" --model "$OLLAMA_TAB" --ollama-options "$opts" >/dev/null
    js "$BENCH" warm --protocol ollama --url "$OLLAMA_URL" --model "$OLLAMA_EMBED" --embed --ollama-options "$opts" >/dev/null
    setj "$f" "helpers_ready_s=$(since "$t0")"
    ok "$label $version: Tab + Router models loaded"
    bench --profile helpers --label "$label" --protocol ollama --ollama-options "$opts" --out "$f" \
      --tab-protocol ollama --tab-url "$OLLAMA_URL" --tab-model "$OLLAMA_TAB" \
      --embed-protocol ollama --embed-url "$OLLAMA_URL" --embed-model "$OLLAMA_EMBED"
    # shellcheck disable=SC2046
    idle_cost "$f" $(ollama_pids)
  fi
  if run_chat "$v"; then
    t0="$(now)"
    js "$BENCH" warm --protocol ollama --url "$OLLAMA_URL" --model "$chat" --ctx "$CTX" --ollama-options "$opts" >/dev/null
    setj "$f" "ready_s=$(since "$t0")"
    local swap0; swap0="$(swap_used)"
    bench --profile chat --label "$label" --protocol ollama --ollama-options "$opts" --out "$f" --chat-url "$OLLAMA_URL" --chat-model "$chat" \
      --tab-protocol ollama --tab-url "$OLLAMA_URL" --tab-model "$OLLAMA_TAB"
    # shellcheck disable=SC2046
    local mem; mem="$(mem_of $(ollama_pids))"
    setj "$f" "memory_gb=${mem% *}" "vram_gb=${mem#* }" "swap_before=$swap0" "swap_after=$(swap_used)"
  fi
  ollama_unload_all
}

engine_llamacpp() {  # id label order variant(metal|cuda|vulkan|cpu)
  local id="$1" label="$2" order="$3" v="$4" f; f="$(record "$id")"
  if [ "$v" = "vulkan" ] && ! ldconfig -p 2>/dev/null | grep -q 'libvulkan\.so\.1'; then
    die "Vulkan isn't installed (Ubuntu: sudo apt install libvulkan1 mesa-vulkan-drivers; NVIDIA's driver brings its own)"
  fi
  local LS; LS="$(install_llamacpp "$v")"
  export LD_LIBRARY_PATH="$(dirname "$LS")${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
  local version gpu="-ngl 99"
  [ "$v" = "cpu" ] && gpu="-ngl 0 -t $LIGHT_THREADS"
  version="$("$LS" --version 2>&1 | grep -m1 -i version | sed 's/^version: *//' || echo '?')"
  setj "$f" "id=$id" "order=$order" "version=llama.cpp $version" "variant=$v" "install_mb=$(size_mb "$(dirname "$LS")")"
  local tab_gguf embed_gguf chat_gguf
  tab_gguf="$(hf_gguf "$LLAMA_TAB_REPO" "$LLAMA_TAB_QUANT")"
  embed_gguf="$(hf_gguf "$LLAMA_EMBED_REPO" "$LLAMA_EMBED_QUANT")" || embed_gguf=""
  run_chat "$v" && chat_gguf="$(hf_gguf "$LLAMA_CHAT_REPO" "$LLAMA_CHAT_QUANT")"
  ollama_unload_all
  local pids="" tab_pid embed_pid chat_pid t0
  trap 'kill $pids 2>/dev/null || true' EXIT
  if run_helpers || run_chat "$v"; then
    t0="$(now)"
    # shellcheck disable=SC2086
    tab_pid="$(start_server "$id-tab" "$LS" -m "$tab_gguf" --host 127.0.0.1 --port "$LLAMA_TAB_PORT" -c 4096 -np 1 $gpu)"; pids="$pids $tab_pid"
    if [ -n "$embed_gguf" ] && run_helpers; then
      # shellcheck disable=SC2086
      embed_pid="$(start_server "$id-embed" "$LS" -m "$embed_gguf" --host 127.0.0.1 --port "$LLAMA_EMBED_PORT" --embeddings $gpu)"; pids="$pids $embed_pid"
    fi
    trap "kill $pids 2>/dev/null || true" EXIT
    wait_ready "http://127.0.0.1:$LLAMA_TAB_PORT/health" "$tab_pid" "$id-tab" 300
    js "$BENCH" warm --protocol llamacpp --url "http://127.0.0.1:$LLAMA_TAB_PORT" >/dev/null
    if [ -n "${embed_pid:-}" ]; then
      wait_ready "http://127.0.0.1:$LLAMA_EMBED_PORT/health" "$embed_pid" "$id-embed" 300
      js "$BENCH" warm --protocol openai --embed --url "http://127.0.0.1:$LLAMA_EMBED_PORT" --model embed >/dev/null
    fi
    setj "$f" "helpers_ready_s=$(since "$t0")"
    ok "$label $version: Tab + Router models loaded"
  fi
  if run_helpers; then
    if [ -n "${embed_pid:-}" ]; then
      bench --profile helpers --label "$label" --protocol openai --out "$f" \
        --tab-protocol llamacpp --tab-url "http://127.0.0.1:$LLAMA_TAB_PORT" --tab-model "$(basename "$tab_gguf")" \
        --embed-protocol openai --embed-url "http://127.0.0.1:$LLAMA_EMBED_PORT" --embed-model "$(basename "$embed_gguf")"
    else
      warn "No embedding model for llama.cpp: Model Router's helper not measured."
      bench --profile helpers --label "$label" --protocol openai --out "$f" \
        --tab-protocol llamacpp --tab-url "http://127.0.0.1:$LLAMA_TAB_PORT" --tab-model "$(basename "$tab_gguf")"
    fi
    # shellcheck disable=SC2086
    idle_cost "$f" $(tree_pids $pids)
  fi
  if run_chat "$v"; then
    t0="$(now)"
    local extra=""
    if ! $THINK && "$LS" --help 2>&1 | grep -q -- '--reasoning-budget'; then extra="--reasoning-budget 0"; fi
    # -np 1: one conversation slot, so the whole context belongs to it (like one Kural chat); --jinja: tool calling.
    # shellcheck disable=SC2086
    chat_pid="$(start_server "$id-chat" "$LS" -m "$chat_gguf" --host 127.0.0.1 --port "$LLAMA_CHAT_PORT" -c "$CTX" -np 1 --jinja $gpu $extra)"
    pids="$pids $chat_pid"; trap "kill $pids 2>/dev/null || true" EXIT
    wait_ready "http://127.0.0.1:$LLAMA_CHAT_PORT/health" "$chat_pid" "$id-chat" 600
    js "$BENCH" warm --protocol llamacpp --url "http://127.0.0.1:$LLAMA_CHAT_PORT" >/dev/null
    setj "$f" "ready_s=$(since "$t0")"
    local swap0; swap0="$(swap_used)"
    bench --profile chat --label "$label" --protocol openai --out "$f" \
      --chat-url "http://127.0.0.1:$LLAMA_CHAT_PORT" --chat-model "$(basename "$chat_gguf")" \
      --tab-protocol llamacpp --tab-url "http://127.0.0.1:$LLAMA_TAB_PORT" --tab-model "$(basename "$tab_gguf")"
    local mem; mem="$(mem_of $(tree_pids "$chat_pid" "$tab_pid"))"
    setj "$f" "memory_gb=${mem% *}" "vram_gb=${mem#* }" "swap_before=$swap0" "swap_after=$(swap_used)"
  fi
}

engine_mlx() {  # id label order
  local id="$1" label="$2" order="$3" f; f="$(record "$id")"
  $IS_MAC_ARM || die "MLX runs only on Apple Silicon Macs"
  local VENV="$HERE/.venv"
  "$VENV/bin/python" -c "import mlx_lm" >/dev/null 2>&1 || py_env "$VENV" mlx-lm
  hf_snapshot "$VENV" "$MLX_TAB"; run_chat gpu && hf_snapshot "$VENV" "$MLX_CHAT"
  ollama_unload_all
  local version extra="" pids="" t0 chat_pid tab_pid
  version="$("$VENV/bin/python" -c 'import mlx_lm; print(mlx_lm.__version__)')"
  setj "$f" "id=$id" "order=$order" "version=mlx-lm $version" "variant=metal" "install_mb=$(size_mb "$VENV")"
  if ! $THINK && "$VENV/bin/mlx_lm.server" --help 2>&1 | grep -q -- '--chat-template-args'; then extra='{"enable_thinking":false}'; fi
  t0="$(now)"
  tab_pid="$(HF_HOME="$CACHE/hf" HF_HUB_OFFLINE=1 start_server "$id-tab" "$VENV/bin/mlx_lm.server" --model "$MLX_TAB" --host 127.0.0.1 --port "$MLX_TAB_PORT")"
  pids="$tab_pid"; trap "kill $pids 2>/dev/null || true" EXIT
  wait_ready "http://127.0.0.1:$MLX_TAB_PORT/v1/models" "$tab_pid" "$id-tab" 300
  js "$BENCH" warm --protocol openai --url "http://127.0.0.1:$MLX_TAB_PORT" --model "$MLX_TAB" >/dev/null
  setj "$f" "helpers_ready_s=$(since "$t0")"
  if run_helpers; then
    warn "mlx_lm.server has no embeddings endpoint: Model Router's helper not measured."
    bench --profile helpers --label "$label" --protocol openai --out "$f" \
      --tab-protocol openai --tab-url "http://127.0.0.1:$MLX_TAB_PORT" --tab-model "$MLX_TAB"
    idle_cost "$f" $(tree_pids "$tab_pid")
  fi
  if run_chat gpu; then
    t0="$(now)"
    if [ -n "$extra" ]; then
      chat_pid="$(HF_HOME="$CACHE/hf" HF_HUB_OFFLINE=1 start_server "$id-chat" "$VENV/bin/mlx_lm.server" --model "$MLX_CHAT" --host 127.0.0.1 --port "$MLX_CHAT_PORT" --chat-template-args "$extra")"
    else
      chat_pid="$(HF_HOME="$CACHE/hf" HF_HUB_OFFLINE=1 start_server "$id-chat" "$VENV/bin/mlx_lm.server" --model "$MLX_CHAT" --host 127.0.0.1 --port "$MLX_CHAT_PORT")"
    fi
    pids="$pids $chat_pid"; trap "kill $pids 2>/dev/null || true" EXIT
    wait_ready "http://127.0.0.1:$MLX_CHAT_PORT/v1/models" "$chat_pid" "$id-chat" 600
    js "$BENCH" warm --protocol openai --url "http://127.0.0.1:$MLX_CHAT_PORT" --model "$MLX_CHAT" >/dev/null
    setj "$f" "ready_s=$(since "$t0")"
    local swap0; swap0="$(swap_used)"
    bench --profile chat --label "$label" --protocol openai --out "$f" --chat-url "http://127.0.0.1:$MLX_CHAT_PORT" --chat-model "$MLX_CHAT" \
      --tab-protocol openai --tab-url "http://127.0.0.1:$MLX_TAB_PORT" --tab-model "$MLX_TAB"
    local mem; mem="$(mem_of $(tree_pids "$chat_pid" "$tab_pid"))"
    setj "$f" "memory_gb=${mem% *}" "vram_gb=${mem#* }" "swap_before=$swap0" "swap_after=$(swap_used)"
  fi
}

# vLLM: a server built for many users at once on NVIDIA GPUs. Each model is its own server that reserves a share of
# GPU memory up front.
engine_vllm() {  # id label order
  local id="$1" label="$2" order="$3" f; f="$(record "$id")"
  $IS_LINUX && $HAS_NVIDIA || die "vLLM needs Linux with an NVIDIA GPU"
  local VENV="$HERE/.venv-vllm"
  "$VENV/bin/python" -c "import vllm" >/dev/null 2>&1 || py_env "$VENV" vllm
  hf_snapshot "$VENV" "$VLLM_TAB"; ( hf_snapshot "$VENV" "$VLLM_EMBED" ) || warn "Embedding model not downloaded; Model Router's helper will be skipped for vLLM."
  run_chat gpu && hf_snapshot "$VENV" "$VLLM_CHAT"
  ollama_unload_all
  local version pids="" t0 tab_pid embed_pid="" chat_pid
  version="$("$VENV/bin/python" -c 'import vllm; print(vllm.__version__)' 2>/dev/null)"
  setj "$f" "id=$id" "order=$order" "version=vLLM $version" "variant=cuda" "install_mb=$(size_mb "$VENV")"
  export HF_HOME="$CACHE/hf" HF_HUB_OFFLINE=1
  t0="$(now)"
  tab_pid="$(start_server "$id-tab" "$VENV/bin/vllm" serve "$VLLM_TAB" --host 127.0.0.1 --port "$VLLM_TAB_PORT" --max-model-len 4096 --gpu-memory-utilization "$VLLM_GPU_SHARE_TAB")"
  pids="$tab_pid"; trap "kill $pids 2>/dev/null || true" EXIT
  wait_ready "http://127.0.0.1:$VLLM_TAB_PORT/health" "$tab_pid" "$id-tab" 1200
  if run_helpers; then
    # The flag for an embedding model changed between vLLM versions: try the new one, then the old one.
    local flags
    for flags in "--runner pooling" "--task embed"; do
      # shellcheck disable=SC2086
      embed_pid="$(start_server "$id-embed" "$VENV/bin/vllm" serve "$VLLM_EMBED" --host 127.0.0.1 --port "$VLLM_EMBED_PORT" --gpu-memory-utilization "$VLLM_GPU_SHARE_EMBED" $flags)"
      local i=0; while [ $i -lt 600 ] && kill -0 "$embed_pid" 2>/dev/null && ! http_ok "http://127.0.0.1:$VLLM_EMBED_PORT/health"; do sleep 1; i=$((i + 1)); done
      if http_ok "http://127.0.0.1:$VLLM_EMBED_PORT/health"; then pids="$pids $embed_pid"; break; fi
      kill "$embed_pid" 2>/dev/null || true; embed_pid=""
    done
    trap "kill $pids 2>/dev/null || true" EXIT
  fi
  js "$BENCH" warm --protocol openai --url "http://127.0.0.1:$VLLM_TAB_PORT" --model "$VLLM_TAB" >/dev/null
  setj "$f" "helpers_ready_s=$(since "$t0")"
  if run_helpers; then
    if [ -n "$embed_pid" ]; then
      bench --profile helpers --label "$label" --protocol openai --out "$f" \
        --tab-protocol openai --tab-url "http://127.0.0.1:$VLLM_TAB_PORT" --tab-model "$VLLM_TAB" \
        --embed-protocol openai --embed-url "http://127.0.0.1:$VLLM_EMBED_PORT" --embed-model "$VLLM_EMBED"
    else
      warn "vLLM couldn't serve the embedding model (log: results/$RUN_ID/$id-embed.log): Model Router's helper not measured."
      bench --profile helpers --label "$label" --protocol openai --out "$f" \
        --tab-protocol openai --tab-url "http://127.0.0.1:$VLLM_TAB_PORT" --tab-model "$VLLM_TAB"
    fi
    # shellcheck disable=SC2086
    idle_cost "$f" $(tree_pids $pids)
  fi
  if run_chat gpu; then
    t0="$(now)"
    chat_pid="$(start_server "$id-chat" "$VENV/bin/vllm" serve "$VLLM_CHAT" --host 127.0.0.1 --port "$VLLM_CHAT_PORT" --max-model-len "$CTX" \
      --gpu-memory-utilization "$VLLM_GPU_SHARE_CHAT" --enable-auto-tool-choice --tool-call-parser hermes)"
    pids="$pids $chat_pid"; trap "kill $pids 2>/dev/null || true" EXIT
    wait_ready "http://127.0.0.1:$VLLM_CHAT_PORT/health" "$chat_pid" "$id-chat" 1200
    js "$BENCH" warm --protocol openai --url "http://127.0.0.1:$VLLM_CHAT_PORT" --model "$VLLM_CHAT" >/dev/null
    setj "$f" "ready_s=$(since "$t0")"
    local swap0; swap0="$(swap_used)"
    bench --profile chat --label "$label" --protocol openai --out "$f" --chat-url "http://127.0.0.1:$VLLM_CHAT_PORT" --chat-model "$VLLM_CHAT" \
      --tab-protocol openai --tab-url "http://127.0.0.1:$VLLM_TAB_PORT" --tab-model "$VLLM_TAB"
    local mem; mem="$(mem_of $(tree_pids "$chat_pid" "$tab_pid"))"
    setj "$f" "memory_gb=${mem% *}" "vram_gb=${mem#* }" "swap_before=$swap0" "swap_after=$(swap_used)"
  fi
}

label_of() {
  case "$1" in
    ollama) echo "Ollama" ;; ollama-cpu) echo "Ollama (CPU)" ;; ollama-mlx) echo "Ollama MLX" ;;
    llamacpp|llamacpp-metal) echo "llama.cpp" ;; llamacpp-cuda) echo "llama.cpp CUDA" ;;
    llamacpp-vulkan) echo "llama.cpp Vulkan" ;; llamacpp-cpu) echo "llama.cpp (CPU)" ;;
    mlx) echo "MLX" ;; vllm) echo "vLLM" ;; *) echo "$1" ;;
  esac
}

# ------------------------------------------------------------------ preflight
step "Kural engine benchmark ($RUN_ID)"
for t in curl perl tar; do command -v "$t" >/dev/null || die "$t is missing"; done
GPU=""
if [ "$OS_NAME" = "Darwin" ]; then
  CHIP="$(sysctl -n machdep.cpu.brand_string)"; MEM_GB=$(( $(sysctl -n hw.memsize) / 1073741824 )); OS="macOS $(sw_vers -productVersion)"; GPU="$CHIP (unified memory)"
else
  CHIP="$(awk -F: '/model name/ {print $2; exit}' /proc/cpuinfo | sed 's/^ *//')"; MEM_GB=$(( ( $(awk '/MemTotal/ {print $2}' /proc/meminfo) + 524288 ) / 1048576 ))
  OS="$(. /etc/os-release 2>/dev/null && echo "$PRETTY_NAME" || uname -sr)"
  if $HAS_NVIDIA; then GPU="$(nvidia-smi --query-gpu=name,memory.total --format=csv,noheader | head -1)"
  else GPU="$(lspci 2>/dev/null | grep -iE 'vga|3d' | head -1 | sed 's/.*: //' || true)"; fi
fi
CORES="$(getconf _NPROCESSORS_ONLN 2>/dev/null || echo '?')"
if [ "$ENGINES" = "auto" ]; then
  if $IS_MAC_ARM; then ENGINES="ollama llamacpp-metal mlx"
  elif $HAS_NVIDIA; then ENGINES="ollama ollama-cpu llamacpp-cuda llamacpp-vulkan llamacpp-cpu vllm"
  else ENGINES="ollama ollama-cpu llamacpp-vulkan llamacpp-cpu"; fi
fi
FREE_GB="$(df -k "$HERE" | awk 'NR==2 { printf "%d", $4 / 1048576 }')"
info "$CHIP ($CORES threads) · ${MEM_GB} GB · ${GPU:-no GPU found} · $OS · ${FREE_GB} GB free disk"
info "Engines: $ENGINES"
info "Profiles: $PROFILES · ${CHAT_RUNS} chats + ${TAB_RUNS} Tab suggestions each · context $CTX · -cpu engines use $LIGHT_THREADS threads"

if pgrep -f "Kural.app/Contents/MacOS" >/dev/null 2>&1 || pgrep -x kural >/dev/null 2>&1; then
  warn "Kural is running. Its Tab Completion talks to the same Ollama and would skew the numbers."
  if [ -t 0 ] && ! $YES; then read -r -p "   Quit Kural, then press Enter (or type c to continue anyway): " _ || true; fi
fi

# What may be downloaded (only what's missing; sizes are rough)
NEED=""
for e in $ENGINES; do
  case "$e" in
    llamacpp*) v="${e#llamacpp}"; v="${v#-}"; v="${v:-metal}"
      [ -n "$(find "$TOOLS/llama.cpp-$v" -name llama-server -type f 2>/dev/null | head -1)" ] || case "$v" in
        cuda) NEED="$NEED\n   - llama.cpp CUDA build + CUDA runtime (~0.6-0.8 GB)" ;; vulkan) NEED="$NEED\n   - llama.cpp Vulkan build (~30 MB)" ;;
        *) NEED="$NEED\n   - llama.cpp $v build (~20 MB)" ;; esac ;;
    mlx) [ -x "$HERE/.venv/bin/python" ] || NEED="$NEED\n   - uv, Python 3.12, mlx-lm (~400 MB) + MLX models (~6.5 GB)" ;;
    vllm) [ -x "$HERE/.venv-vllm/bin/python" ] || NEED="$NEED\n   - uv, Python 3.12, vLLM with PyTorch and CUDA (~6-8 GB) + models (~6 GB)" ;;
  esac
done
case "$ENGINES" in *llamacpp*) [ -d "$CACHE/gguf" ] || NEED="$NEED\n   - GGUF models: Tab (~1.6 GB), Router helper (~0.1 GB), chat (~2.5-6 GB)" ;; esac
case "$ENGINES" in *ollama*) NEED="$NEED\n   - Ollama models not pulled yet: $OLLAMA_TAB, $OLLAMA_EMBED, $OLLAMA_CHAT" ;; esac
if [ -n "$NEED" ]; then
  step "May download first (into benchmark/, once)"
  printf "%b\n" "${NEED#\\n}"
  if [ -t 0 ] && ! $YES; then
    read -r -p "   Download what's missing and continue? [Y/n] " answer || true
    case "${answer:-y}" in [Yy]*) ;; *) echo "   Stopped. Nothing was downloaded."; exit 0 ;; esac
  fi
fi

setj "$OUT/run.json" "date=$RUN_ID" "chip=$CHIP" "cores=$CORES" "memory_gb=$MEM_GB" "gpu=$GPU" "os=$OS" "ctx=$CTX" \
  "prompt_tokens=$PROMPT_TOKENS" "think=$THINK" "engines=$ENGINES" "profiles=$PROFILES" "chat_runs=$CHAT_RUNS" \
  "tab_runs=$TAB_RUNS" "light_threads=$LIGHT_THREADS" "helpers_weight=$HELPERS_WEIGHT"

# ------------------------------------------------------------------ the engines
order=0; first=true
for e in $ENGINES; do
  order=$((order + 1)); label="$(label_of "$e")"
  if ! $first && [ "$COOLDOWN_S" -gt 0 ]; then info "Cooling down ${COOLDOWN_S} s before the next engine…"; sleep "$COOLDOWN_S"; fi
  first=false
  step "$order. $label"
  set +e
  (
    set -e
    case "$e" in
      ollama) engine_ollama ollama "$label" "$order" gpu ;;
      ollama-cpu) engine_ollama ollama-cpu "$label" "$order" cpu ;;
      ollama-mlx) engine_ollama ollama-mlx "$label" "$order" mlx ;;
      llamacpp|llamacpp-metal) engine_llamacpp llamacpp "$label" "$order" metal ;;
      llamacpp-cuda) engine_llamacpp "$e" "$label" "$order" cuda ;;
      llamacpp-vulkan) engine_llamacpp "$e" "$label" "$order" vulkan ;;
      llamacpp-cpu) engine_llamacpp "$e" "$label" "$order" cpu ;;
      mlx) engine_mlx mlx "$label" "$order" ;;
      vllm) engine_vllm vllm "$label" "$order" ;;
      *) die "unknown engine '$e' (see config.sh)" ;;
    esac
  )
  rc=$?
  set -e
  if [ "$rc" -ne 0 ]; then
    sleep 1   # let tee finish writing run.log
    reason="$(grep -E 'Error: |bench.js: ' "$OUT/run.log" | tail -1 | sed -E 's/.*(Error: |bench.js: )//; s/\x1b\[[0-9;]*m//g')"
    id="$e"; [ "$e" = "llamacpp-metal" ] && id="llamacpp"
    skip_engine "$id" "$label" "$order" "${reason:-failed (see run.log)}"
  fi
done

# ------------------------------------------------------------------ the comparison
step "Comparison"
js "$HERE/lib/report.js" "$OUT"
ln -sfn "$RUN_ID" "$HERE/results/latest"
if [ -f "$OUT/report.html" ]; then
  if [ "$OS_NAME" = "Darwin" ]; then open "$OUT/report.html"; elif [ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ] && command -v xdg-open >/dev/null; then xdg-open "$OUT/report.html" >/dev/null 2>&1 & fi
fi
echo
ok "Done. Everything from this run: benchmark/results/$RUN_ID/"

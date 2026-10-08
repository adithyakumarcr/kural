# Kural engine benchmark

Which engine should run "your own model" in Kural? This measures each one on what Kural actually does and ends with a
comparison report (`results/<run>/report.html`, opened automatically on a Mac).

**Run it:** `benchmark/run.sh` on macOS or Linux (on a Mac you can also double-click `Run Benchmark.command`).
`--quick` for a first look, `--engines "ollama llamacpp-vulkan"`, `--profiles helpers`, `--yes` to skip the download
question. Quit Kural first: its Tab Completion shares Ollama.

## Two profiles, because Kural has two kinds of users

- **helpers** (everyone): even with Claude, ChatGPT or Gemini for the chat, Tab Completion (a 1.5B code model) and
  Model Router's helper (`granite-embedding:30m`) run locally. Measured: Tab latency, helper latency, idle memory,
  idle CPU, start time, engine size. The `-cpu` engines leave the GPU out and use `LIGHT_THREADS` cores: a
  lightweight laptop.
- **chat** ("your own model"): the workloads below.

The report gives each profile a score and an overall score (`HELPERS_WEIGHT` in `config.sh`, 70 % helpers by default).

## What it measures (the same for every engine)

| # | Workload | Kural feature |
|---|---|---|
| 1 | A new chat: Kural's system prompt + its 6 tools + ~9,600 tokens of this repo's source | New chat: time to first word, writing speed |
| 2 | One more message in that chat | Every agent step after the first; shows whether the engine reuses its cache |
| 3 | Fill-in-the-middle with the Tab model, the same raw prompt as `extension/lib/tab/local.js` | Tab Completion |
| 4 | (3) while (1) runs | Tab Completion while an agent works (one GPU for both) |
| + | Memory of the engine's processes, swap, cold start | Fits on a 16 GB Mac? |

Times are measured from the client side for every engine (request sent to first streamed token), so the engines are
compared by what a user would feel, not by each engine's own counters.

## Engines

`ENGINES="auto"` picks what fits the computer: Mac `ollama llamacpp-metal mlx`; Linux + NVIDIA
`ollama ollama-cpu llamacpp-cuda llamacpp-vulkan llamacpp-cpu vllm`; other Linux the same without CUDA and vLLM.

| id | Engine | Installed by run.sh into |
|---|---|---|
| `ollama`, `ollama-cpu` | Ollama, native API (what Kural uses today); `-cpu`: GPU left out | pulls missing models into Ollama |
| `llamacpp-metal/-cuda/-vulkan/-cpu` | llama.cpp `llama-server`, one build each | `.tools/` (GitHub releases), GGUF in `.cache/gguf` |
| `mlx` | Apple MLX, `mlx_lm.server` (Mac) | `.venv/` (via uv), models in `.cache/hf` |
| `vllm` | vLLM (Linux + NVIDIA) | `.venv-vllm/` (via uv, several GB), models in `.cache/hf` |
| `ollama-mlx` | Ollama's MLX engine (opt-in, Mac) | pulls into Ollama |

Not included: **Strata** (no macOS support, built for one 125B model).

## Change things

`config.sh`: models, context, prompt size, runs, cooldown. `lib/report.js` → `WEIGHTS`: what "best" means.
If a Hugging Face repo name in `config.sh` is wrong, that engine is skipped with the reason and the others still run.

## Files

`run.sh` (installs, starts and stops each engine), `lib/bench.js` (the workloads, no dependencies),
`lib/report.js` (comparison + HTML). Delete `.tools/ .venv/ .venv-vllm/ .cache/` to remove everything it installed (all git-ignored, like `results/`).

# Kural engine benchmark: settings. run.sh reads this file; flags on run.sh override some of it.
# Plain shell variables. Model names are what you're most likely to change.

# Which engines ("auto" picks what fits this computer):
#   macOS (Apple Silicon): ollama llamacpp-metal mlx
#   Linux with NVIDIA:     ollama ollama-cpu llamacpp-cuda llamacpp-vulkan llamacpp-cpu vllm
#   Linux without NVIDIA:  ollama ollama-cpu llamacpp-vulkan llamacpp-cpu
# All ids: ollama, ollama-cpu, ollama-mlx, llamacpp-metal, llamacpp-cuda, llamacpp-vulkan, llamacpp-cpu, mlx, vllm
# (-cpu engines leave the GPU out and use LIGHT_THREADS cores: what Kural gets on a lightweight laptop)
ENGINES="auto"

# What to measure (run.sh --profiles):
#   helpers  every Kural user, even with Claude/ChatGPT/Gemini: Tab Completion + Model Router's embedding helper
#   chat     "your own model": new chat, follow-up, Tab while the chat answers
PROFILES="helpers chat"
CHAT_ON_CPU=false     # run the chat profile on the -cpu engines too (slow: minutes per answer)
LIGHT_THREADS=4       # cores the -cpu engines may use (a typical lightweight laptop)
HELPERS_WEIGHT=70     # % of the overall score from the helpers profile (most users); the rest from chat

# The workload (the same for every engine)
PROMPT_TOKENS=9600    # agent prompt size (Kural's chat measured 9,600 tokens on 8 Oct 2026)
CHAT_RUNS=2           # new chats per engine (the median is reported)
TAB_RUNS=10           # Tab suggestions per scenario
ANSWER_TOKENS=256     # longest chat answer
THINK=false           # true: let thinking models think (Kural does unless effort is "low")
COOLDOWN_S=45         # pause between engines (a hot laptop gets slower)
IDLE_S=10             # how long idle CPU use is measured

# Ollama (missing models are pulled)
OLLAMA_URL="http://127.0.0.1:11434"
OLLAMA_TAB="qwen2.5-coder:1.5b-base"
OLLAMA_EMBED="granite-embedding:30m"     # Model Router's recommended helper
OLLAMA_MLX_CHAT="qwen3.5:9b-mlx"

# llama.cpp: GGUF files from Hugging Face (repo + preferred quantizations, first found wins). A repo that doesn't
# exist is searched for by its name.
LLAMA_TAB_REPO="ggml-org/Qwen2.5-Coder-1.5B-Q8_0-GGUF";  LLAMA_TAB_QUANT="Q8_0"
LLAMA_EMBED_REPO="granite-embedding-30m-english-GGUF";    LLAMA_EMBED_QUANT="Q8_0 F16 F32"
LLAMA_CHAT_PORT=8081; LLAMA_TAB_PORT=8082; LLAMA_EMBED_PORT=8083

if [ "$(uname -s)" = "Darwin" ]; then
  CTX=32768
  OLLAMA_CHAT="qwen3.5:9b"
  LLAMA_CHAT_REPO="unsloth/Qwen3.5-9B-GGUF";  LLAMA_CHAT_QUANT="Q4_K_M"
else
  # Lightweight Linux laptops: a 4B chat model and a 16k context (Kural's suggestion for 8-16 GB machines).
  CTX=16384
  OLLAMA_CHAT="qwen3:4b"
  LLAMA_CHAT_REPO="Qwen/Qwen3-4B-GGUF";       LLAMA_CHAT_QUANT="Q4_K_M"
fi

# MLX (macOS only): models from Hugging Face's mlx-community
MLX_CHAT="mlx-community/Qwen3.5-9B-4bit"
MLX_TAB="mlx-community/Qwen2.5-Coder-1.5B-4bit"
MLX_EMBED=""                                  # mlx_lm.server has no embeddings endpoint
MLX_CHAT_PORT=8091; MLX_TAB_PORT=8092

# vLLM (Linux + NVIDIA only): Hugging Face models (vLLM doesn't run GGUF well; AWQ is its 4-bit format)
VLLM_CHAT="Qwen/Qwen3-4B-AWQ"
VLLM_TAB="Qwen/Qwen2.5-Coder-1.5B"
VLLM_EMBED="ibm-granite/granite-embedding-30m-english"
VLLM_GPU_SHARE_CHAT=0.50; VLLM_GPU_SHARE_TAB=0.20; VLLM_GPU_SHARE_EMBED=0.08   # vLLM reserves this share of GPU memory up front
VLLM_CHAT_PORT=8101; VLLM_TAB_PORT=8102; VLLM_EMBED_PORT=8103

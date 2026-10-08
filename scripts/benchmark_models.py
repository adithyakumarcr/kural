"""Benchmark Qwen 7B and 14B models on Mac (M-series).

Measures tokens per second (tps) and latency for CPU/GPU.
Use Ollama (recommended) or llama-cpp-python.

Setup:
  - Install: pip install ollama
  - Pull models: ollama pull qwen2.5:7b-instruct-q4_k_m
                   ollama pull qwen2.5:14b-instruct-q4_k_m
  - Run: python benchmark_models.py
"""

from __future__ import annotations

import time
import subprocess


# --- Model Configuration ------------------------------------------------------
MODELS = {
    # Option 1: Ollama (recommended for Mac M-series)
    # Pull with: ollama pull qwen2.5:7b-instruct-q4_k_m
    "qwen_7b": {
        "name": "Qwen2.5-7B-Instruct (Ollama)",
        "ollama_name": "qwen2.5:7b-instruct-q4_k_m",  # adjust for your exact tag
        "device": "auto"  # or "cpu"/"cuda"
    },
    # Option 2: Ollama 14B
    # Pull with: ollama pull qwen2.5:14b-instruct-q4_k_m
    "qwen_14b": {
        "name": "Qwen2.5-14B-Instruct (Ollama)",
        "ollama_name": "qwen2.5:14b-instruct-q4_k_m",  # adjust for your exact tag
        "device": "auto"
    },
}

# --- Benchmark settings --------------------------------------------------------
NUM_PROMPTS = 3  # number of prompts to run
WARMUP_PROMPT = "Count the number of words in this sentence: 'The quick brown fox jumps over the lazy dog.'"


def benchmark_ollama(model_name: str, ollama_name: str, num_prompts: int) -> dict:
    """Run benchmark using Ollama API (recommended for Mac)."""
    result = {
        "name": model_name,
        "model_path": None,
        "total_time_s": 0.0,
        "tokens_generated": 0,
        "tps": 0.0,
        "latency_avg_s": 0.0,
    }

    print(f"\n[Benchmark] {model_name}...")

    # Warm up: ensure model is loaded
    print(f"  [Warm-up] Loading model from disk...")
    try:
        resp = subprocess.run(
            ["ollama", "run", ollama_name, WARMUP_PROMPT, "-p", ""],
            capture_output=True, text=True, timeout=300,
            check=False,
        )
        if resp.returncode != 0 and "pulling" not in resp.stderr:
            print(f"  [ERROR] Model not found or failed to load: {resp.stderr[:200]}")
    except subprocess.TimeoutExpired:
        print(f"  [ERROR] Timeout warming up {model_name}")
        return result

    # Benchmark: run multiple prompts
    prompt_texts = [
        "What is the capital of France?",
        "Write a short poem about the ocean.",
        "Explain quantum entanglement in simple terms.",
        "Compare Python and JavaScript for web development.",
        "Solve this math problem: (2+3)*(5-1)/2 = ?",
    ][:num_prompts]

    print(f"  Running {len(prompt_texts)} prompts...")
    start_time = time.time()
    all_times = []
    total_tokens = 0

    for i, prompt in enumerate(prompt_texts):
        full_prompt = f"{prompt}\n\nResponse:"
        try:
            proc = subprocess.run(
                ["ollama", "run", ollama_name, full_prompt],
                capture_output=True, text=True, timeout=300,
            )

            # Extract generated text after "Response:" marker
            gen_text = proc.stdout.split("Response:")[-1].strip() if "Response:" in proc.stdout else ""
            
            # Rough token estimate (words)
            tokens = len(gen_text.split()) if gen_text else 0
            total_tokens += tokens

            elapsed = time.time() - start_time
            all_times.append(elapsed)

        except subprocess.TimeoutExpired:
            print(f"    Prompt {i+1}/{len(prompt_texts)} timed out")
            break
        except Exception as e:
            print(f"    Prompt {i+1}/{len(prompt_texts)} failed: {e}")
            continue

    result["total_time_s"] = time.time() - start_time
    result["tokens_generated"] = total_tokens
    result["tps"] = (result["tokens_generated"] / result["total_time_s"]) if result["total_time_s"] > 0 else 0.0
    result["latency_avg_s"] = sum(all_times) / len(all_times) if all_times else 0.0

    print(f"  [Done] {model_name}:")
    print(f"           - Total time: {result['total_time_s']:.2f}s")
    print(f"           - Tokens generated: {result['tokens_generated']}")
    print(f"           - TPS: {result['tps']:.2f}")
    print(f"           - Avg latency: {result['latency_avg_s']:.4f}s")

    return result


def benchmark_transformers(model_name: str, model_path: str, num_prompts: int) -> dict:
    """Run benchmark using transformers + llama-cpp-python backend."""
    try:
        from transformers import AutoTokenizer, AutoModelForCausalLM, GenerationConfig
        import torch

        print(f"\n[Benchmark] {model_name} (Transformers)...")
        result = {
            "name": model_name,
            "model_path": model_path,
            "total_time_s": 0.0,
            "tokens_generated": 0,
            "tps": 0.0,
            "latency_avg_s": 0.0,
        }

        # Load tokenizer
        print(f"  Loading tokenizer for {model_name}...")
        tokenizer = AutoTokenizer.from_pretrained(model_path)

        # Load model (this may take several minutes depending on GPU/CPU)
        print(f"  Loading model from {model_path}...")
        device_map = {"": "cuda"} if torch.cuda.is_available() else {"": "cpu"}
        model = AutoModelForCausalLM.from_pretrained(
            model_path,
            device_map=device_map,
            torch_dtype="auto",
        )

        print(f"  Model loaded. Starting benchmark...")
        start_time = time.time()

        prompts = [
            "What is the capital of France?",
            "Write a short poem about the ocean.",
            "Explain quantum entanglement in simple terms.",
        ][:num_prompts]

        prompt_inputs = tokenizer(prompts, return_tensors="pt", padding=True)
        inputs = prompt_inputs.to(model.device)

        model.config.use_cache = False  # faster inference
        generation_config = GenerationConfig(
            max_new_tokens=64,
            temperature=0.7,
            do_sample=True,
        )

        all_times = []
        total_tokens = 0

        for i, prompt in enumerate(prompts):
            with torch.no_grad():
                outputs = model.generate(**inputs, generation_config=generation_config)

            gen_text = tokenizer.decode(outputs[0], skip_special_tokens=True)
            tokens = len(gen_text.split()) if gen_text else 0
            total_tokens += tokens

            elapsed = time.time() - start_time
            all_times.append(elapsed)
            print(f"    Prompt {i+1}/{len(prompts)}: cumulative time {elapsed:.2f}s")

        result["total_time_s"] = time.time() - start_time
        result["tokens_generated"] = total_tokens
        result["tps"] = (result["tokens_generated"] / result["total_time_s"]) if result["total_time_s"] > 0 else 0.0
        result["latency_avg_s"] = sum(all_times) / len(all_times) if all_times else 0.0

    except Exception as e:
        print(f"  [ERROR] Failed to benchmark with transformers: {e}")

    return result


def main() -> None:
    """Run benchmarks for all configured models."""
    print("=" * 70)
    print("QWEN MODEL SPEED BENCHMARK")
    print("=" * 70)
    print("\nThis benchmark measures:")
    print("  - Tokens per second (tps)")
    print("  - Average latency per prompt")
    print("  - Total time for all prompts\n")

    # Initialize results list
    results = []

    # --- Benchmark using Ollama (recommended) -----------------------------------
    if "OLLAMA_MODELS" in globals():
        for model_key, model_info in MODELS.items():
            result = benchmark_ollama(
                model_name=model_info["name"],
                ollama_name=model_info["ollama_name"],
                num_prompts=NUM_PROMPTS,
            )
            results.append(result)

    # --- OR benchmark using transformers (alternative) --------------------------
    # For alternative models not in Ollama registry, uncomment these lines:
    # model_path_7b = "/path/to/qwen-2-7b-instruct-gguf/q4_k_m.gguf"
    # model_path_14b = "/path/to/qwen-2-14b-instruct-gguf/q8_k.gguf"
    # results.append(benchmark_transformers("Qwen-7B", model_path_7b))
    # results.append(benchmark_transformers("Qwen-14B", model_path_14b))

    # --- Print Results Table ----------------------------------------------------
    if results:
        print("\n" + "=" * 70)
        print("RESULTS")
        print("=" * 70)
        header = f"{'Model':<35} {'Total Time (s)':>12} {'Tokens':>8} {'TPS':>8} {'Avg Latency (s)':>14}"
        line = "-" * len(header)
        print(header)
        print(line)

        for r in results:
            row = f"{r['name']:<35} {r['total_time_s']:>12.3f} {r['tokens_generated']:>8,} {r['tps']:>8.2f} {r['latency_avg_s']:>14.4f}"
            print(row)

        line = "-" * len(header)
        print(line)

        # Calculate summary
        if results:
            avg_tps = sum(r["tps"] for r in results) / len(results)
            best_model = min(results, key=lambda x: x["total_time_s"])
            worst_model = max(results, key=lambda x: x["total_time_s"])

            print(f"Average TPS (all models): {avg_tps:.2f}")
            print(f"Fastest model: {best_model['name']} ({best_model['tps']:.2f} tps)")
            print(f"Slowest model: {worst_model['name']} ({worst_model['tps']:.2f} tps)")

            # Save to CSV if desired
            csv_path = "benchmark_results.csv"
            with open(csv_path, "w", encoding="utf-8") as f:
                f.write("Model,Total Time (s),Tokens,TPS,Avg Latency (s)\n")
                for r in results:
                    f.write(f"{r['name']},{r['total_time_s']},{r['tokens_generated']},{r['tps']},{r['latency_avg_s']}\n")

            print(f"\nResults saved to {csv_path}")

    else:
        print("\nNo models configured or benchmark completed.")


if __name__ == "__main__":
    main()

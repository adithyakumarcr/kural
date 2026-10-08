#!/bin/bash
# Setup script for benchmarking Qwen 7B and 14B models on Mac
# Uses Ollama (recommended for M-series chips)

echo "========================================"
echo "QWEN MODEL BENCHMARK SETUP"
echo "========================================"

echo ""
echo "This benchmark uses Ollama for best performance on Mac."
echo ""

echo "Step 1: Install Ollama (if not already installed)"
echo "  Visit: https://ollama.com/download"
echo "  Or install with: brew install ollama"
echo ""

echo "Step 2: Pull Qwen models to your Mac"
echo ""
echo "For 7B model (approx 4GB):"
echo "  ollama pull qwen2.5:7b-instruct-q4_k_m"
echo ""
echo "For 14B model (approx 9GB):"
echo "  ollama pull qwen2.5:14b-instruct-q4_k_m"
echo ""

echo "Step 3: Run the benchmark"
echo ""
echo "  cd /Users/adithyakumar/Projects/test_opus/"
echo "  python benchmark_models.py"
echo ""

echo "========================================"
echo "Alternative: Using llama-cpp-python (Transformers)"
echo "========================================"
echo ""
echo "If you prefer using llama-cpp-python instead:"
echo ""
echo "Step A: Install dependencies"
echo "  pip install transformers llama-cpp-python torch"
echo ""
echo "Step B: Set up paths in benchmark_models.py CONFIG dict"
echo "       Change 'device': 'auto' to 'cpu' for CPU-only"
echo ""

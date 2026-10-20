#!/usr/bin/env bash
# Compiles whisper.cpp (the program that runs Whisper; nothing is trained) to WebAssembly for Kural's voice input.
# Output in dist/whisper-wasm/: kural-whisper.js (loader + the threads' worker code) and kural-whisper.wasm, plus
# SHA256SUMS and whisper.cpp's license. Needs Docker. Usage: scripts/whisper-wasm/build.sh
# The CI workflow .github/workflows/whisper-wasm.yml runs this and publishes the files on the release whisper-wasm-1.9.5;
# extension/lib/voice/assets.js pins their sizes and hashes.
set -euo pipefail
cd "$(dirname "$0")/../.."
WHISPER_TAG=v1.9.5
# emscripten/emsdk:6.0.12-x64, pinned by digest so the same source gives the same files
IMAGE=emscripten/emsdk@sha256:52549e68ad6dd0f3509ff378bc1a5d317d40030c8991919cada0dad95d85e00c
SRC=dist/whisper-src OUT=dist/whisper-wasm

if [ ! -d "$SRC/.git" ] || [ "$(git -C "$SRC" describe --tags --exact-match 2>/dev/null)" != "$WHISPER_TAG" ]; then
  rm -rf "$SRC"
  git -c advice.detachedHead=false clone -q --depth 1 --branch "$WHISPER_TAG" https://github.com/ggml-org/whisper.cpp "$SRC"
fi
rm -rf "$OUT" && mkdir -p "$OUT"
cp scripts/whisper-wasm/kural-whisper.cpp "$SRC/kural-whisper.cpp"

docker run --rm -u "$(id -u):$(id -g)" -e HOME=/tmp -v "$PWD/$SRC:/src" -v "$PWD/$OUT:/out" -w /src "$IMAGE" bash -euc '
  emcmake cmake -S . -B build-kural -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF \
    -DWHISPER_BUILD_EXAMPLES=OFF -DWHISPER_BUILD_TESTS=OFF -DWHISPER_BUILD_SERVER=OFF -DWHISPER_SDL2=OFF \
    -DGGML_NATIVE=OFF -DGGML_OPENMP=OFF >/dev/null
  cmake --build build-kural -j"$(nproc)" --target whisper >/dev/null
  em++ -O3 -pthread -msimd128 -std=c++17 kural-whisper.cpp -I include -I ggml/include \
    $(find build-kural -name "*.a" | sort) \
    --bind -s MODULARIZE=1 -s EXPORT_NAME=createWhisper -s ENVIRONMENT=node,worker \
    -s PTHREAD_POOL_SIZE=8 -s INITIAL_MEMORY=768MB -s ALLOW_MEMORY_GROWTH=1 -s MAXIMUM_MEMORY=4GB -s STACK_SIZE=5242880 \
    -o /out/kural-whisper.js
'
cp "$SRC/LICENSE" "$OUT/LICENSE-whisper.cpp"
(cd "$OUT" && sha256sum kural-whisper.js kural-whisper.wasm > SHA256SUMS && cat SHA256SUMS && ls -l)

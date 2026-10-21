#!/usr/bin/env bash
# Makes the voice runtime for Kural's Listen (spoken walkthroughs of chat answers): Microsoft's native ONNX Runtime for
# Node (the npm package onnxruntime-node 1.23.2, MIT). Nothing is compiled: the package's CPU files for the platforms Kural
# ships on are taken as they are, and its JavaScript (with onnxruntime-common's) is bundled into one file, ort-node.js,
# that loads the native binding from its own folder. Output in dist/tts-runtime/, with SHA256SUMS and the license.
# Needs Node and curl. Usage: scripts/tts-runtime/build.sh
# The workflow .github/workflows/tts-runtime.yml runs this and publishes the files on the release tts-runtime-1.23.2;
# extension/lib/listen/assets.js pins their sizes and hashes.
set -euo pipefail
cd "$(dirname "$0")/../.."
VER=1.23.2
ESBUILD=0.28.2
# npm's own integrity values for the two packages (sha512, base64)
ORT_NODE_SHA512=OBTsG0W8ddBVOeVVVychpVBS87A9YV5sa2hJ6lc025T97Le+J4v++PwSC4XFs1C62SWyNdof0Mh4KvnZgtt4aw==
ORT_COMMON_SHA512=5LFsC9Dukzp2WV6kNHYLNzp8sT6V02IubLCbzw2Xd6X5GOlr65gAX6xiJwyi2URJol/s71gaQLC5F2C25AAR2w==
WORK=dist/tts-runtime-src OUT=dist/tts-runtime

fetch() {   # name, sha512 → $WORK/node_modules/<name>
  local tgz="$WORK/$1.tgz"
  curl -sSfL "https://registry.npmjs.org/$1/-/$1-$VER.tgz" -o "$tgz"
  local got; got=$(openssl dgst -sha512 -binary "$tgz" | openssl base64 -A)
  [ "$got" = "$2" ] || { echo "::error::$1-$VER.tgz doesn't match npm's integrity value"; exit 1; }
  mkdir -p "$WORK/node_modules/$1" && tar -xzf "$tgz" -C "$WORK/node_modules/$1" --strip-components=1
}
rm -rf "$WORK" "$OUT" && mkdir -p "$WORK" "$OUT"
fetch onnxruntime-node "$ORT_NODE_SHA512"
fetch onnxruntime-common "$ORT_COMMON_SHA512"

# The binding is loaded from beside ort-node.js, not from the package's bin/napi-v6/<platform>/<arch>/ folder.
B="$WORK/node_modules/onnxruntime-node/dist/binding.js"
grep -q 'require(`../bin/napi-v6/${process.platform}/${process.arch}/onnxruntime_binding.node`)' "$B" \
  || { echo "::error::onnxruntime-node's binding.js changed: update build.sh"; exit 1; }
sed -i 's|require(`../bin/napi-v6/${process.platform}/${process.arch}/onnxruntime_binding.node`)|require(require("path").join(__dirname, "onnxruntime_binding.node"))|' "$B"
echo 'module.exports = require("onnxruntime-node");' > "$WORK/entry.js"
(cd "$WORK" && npx --yes "esbuild@$ESBUILD" entry.js --bundle --platform=node --format=cjs --target=node18 \
  --legal-comments=inline --log-level=warning --outfile=../tts-runtime/ort-node.js)

BIN="$WORK/node_modules/onnxruntime-node/bin/napi-v6"
put() { cp "$BIN/$1/$2" "$OUT/$(echo "$1" | tr / -)-$2"; }
put linux/x64 onnxruntime_binding.node;    put linux/x64 libonnxruntime.so.1
put darwin/arm64 onnxruntime_binding.node; put darwin/arm64 libonnxruntime.1.23.2.dylib
put win32/x64 onnxruntime_binding.node;    put win32/x64 onnxruntime.dll
cp "$WORK/node_modules/onnxruntime-node/LICENSE" "$OUT/LICENSE-onnxruntime" 2>/dev/null \
  || curl -sSfL "https://raw.githubusercontent.com/microsoft/onnxruntime/v$VER/LICENSE" -o "$OUT/LICENSE-onnxruntime"
(cd "$OUT" && sha256sum ort-node.js *-onnxruntime_binding.node *-libonnxruntime* *-onnxruntime.dll > SHA256SUMS && cat SHA256SUMS)

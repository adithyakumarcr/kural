// Listen: the voice Kural downloads the first time you press Listen (no vscode inside). Nothing about it ships with Kural.
// Each file is pinned here by size and SHA-256 (voice input's Assets: a download that doesn't match is deleted and refused).
//   - The voice: Supertonic 3 (Supertone, OpenRAIL-M; its LICENSE comes with it), from Hugging Face at a fixed commit.
//     (Chosen by ear in the spike: docs/benchmarks/listen-2026-10-21.md.)
//   - The runtime: Microsoft's ONNX Runtime for Node 1.23.2 (MIT), native, one set per platform, published on this repo's
//     release tts-runtime-1.23.2 by scripts/tts-runtime/build.sh (.github/workflows/tts-runtime.yml checks it against
//     these pins). ort-node.js is its JavaScript, bundled, loading the native binding from its own folder.
const { Assets } = require("../voice/assets");

const MODEL = "https://huggingface.co/supertone-oss-archive/supertonic-3/resolve/aafc6e32416a594460b32413efc49d7fe4ce6d46";
const RUNTIME = "https://github.com/adithyakumarcr/kural/releases/download/tts-runtime-1.23.2";

const SUPERTONIC = [
  { name: "dp", file: "duration_predictor.onnx", url: `${MODEL}/onnx/duration_predictor.onnx`, size: 3700147,
    sha256: "c3eb91414d5ff8a7a239b7fe9e34e7e2bf8a8140d8375ffb14718b1c639325db" },
  { name: "te", file: "text_encoder.onnx", url: `${MODEL}/onnx/text_encoder.onnx`, size: 36416150,
    sha256: "c7befd5ea8c3119769e8a6c1486c4edc6a3bc8365c67621c881bbb774b9902ff" },
  { name: "ve", file: "vector_estimator.onnx", url: `${MODEL}/onnx/vector_estimator.onnx`, size: 256534781,
    sha256: "883ac868ea0275ef0e991524dc64f16b3c0376efd7c320af6b53f5b780d7c61c" },
  { name: "voc", file: "vocoder.onnx", url: `${MODEL}/onnx/vocoder.onnx`, size: 101424195,
    sha256: "085de76dd8e8d5836d6ca66826601f615939218f90e519f70ee8a36ed2a4c4ba" },
  { name: "cfg", file: "tts.json", url: `${MODEL}/onnx/tts.json`, size: 8253,
    sha256: "42078d3aef1cd43ab43021f3c54f47d2d75ceb4e75f627f118890128b06a0d09" },
  { name: "indexer", file: "unicode_indexer.json", url: `${MODEL}/onnx/unicode_indexer.json`, size: 277676,
    sha256: "9bf7346e43883a81f8645c81224f786d43c5b57f3641f6e7671a7d6c493cb24f" },
  { name: "voice", file: "F1.json", url: `${MODEL}/voice_styles/F1.json`, size: 292046,
    sha256: "bbdec6ee00231c2c742ad05483df5334cab3b52fda3ba38e6a07059c4563dbc2" },
  { name: "license", file: "LICENSE-supertonic", url: `${MODEL}/LICENSE`, size: 15007,
    sha256: "0d944a9110fed9a9602d60e0423a272903e7bd21ab060490774efc77c2275e9f" },
];

const ORT_JS = { name: "ort", file: "ort-node.js", url: `${RUNTIME}/ort-node.js`, size: 62777,
  sha256: "f866ce712adbfcbba878c0cbcda4a315fc9b0343704a9eeac9269c4a563f68c9" };
// Saved under the names the binding looks for; on the release each carries its platform first.
const NATIVE = {
  "linux-x64": [
    { name: "binding", file: "onnxruntime_binding.node", size: 369032, sha256: "230a3094dba6a95f299a617d6399537cd56d6848249b45f7415fee34d2beb1ef" },
    { name: "lib", file: "libonnxruntime.so.1", size: 32735928, sha256: "733854c3d7ce45256cc1c22cd4a30373247e1f7b7de8f40beab24211ef8e2a76" },
  ],
  "darwin-arm64": [
    { name: "binding", file: "onnxruntime_binding.node", size: 238872, sha256: "29c18bc05a0c9577fde8856432f29cdcccf0e5c92440a69f196ac37505ad8b35" },
    { name: "lib", file: "libonnxruntime.1.23.2.dylib", size: 35715416, sha256: "7d5ac8528f16a5d157c53eadb4c766bc23f0dbf02c994fb900303e27806e372c" },
  ],
  "win32-x64": [
    { name: "binding", file: "onnxruntime_binding.node", size: 294944, sha256: "da279d977291af6d759388fccfad7117e382a1eef990cde198902a85a62d21cc" },
    { name: "lib", file: "onnxruntime.dll", size: 23595552, sha256: "63168d83986667a1d3b3af081dffe4afc3f3ffbc6235e5862c4bae51b411adaf" },
  ],
};

const ENGINES = {
  supertonic: { label: "The voice", rate: 44100, voice: "F1", tags: ["laugh", "breath", "sigh"], model: SUPERTONIC },
};

const platformKey = (platform = process.platform, arch = process.arch) => `${platform}-${arch}`;
const supported = (engine, platform, arch) => !!(ENGINES[engine] && NATIVE[platformKey(platform, arch)]);

// The engine's files for a platform (null: Kural has no voice runtime for it).
function filesFor(engine, platform = process.platform, arch = process.arch) {
  const key = platformKey(platform, arch), native = NATIVE[key];
  if (!ENGINES[engine] || !native) return null;
  return [...ENGINES[engine].model, ORT_JS, ...native.map((f) => ({ ...f, url: `${RUNTIME}/${key}-${f.file}` }))];
}

const totalBytes = (engine, platform, arch) => (filesFor(engine, platform, arch) || []).reduce((n, f) => n + f.size, 0);

// opts.files: stand-ins in tests
function assetsFor(dir, engine, opts = {}) {
  return new Assets(dir, { files: opts.files || filesFor(engine) || [], label: ENGINES[engine].label, ...(opts.download ? { download: opts.download } : {}) });
}

module.exports = { ENGINES, NATIVE, ORT_JS, filesFor, assetsFor, totalBytes, supported, platformKey };

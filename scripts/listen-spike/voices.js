// Throwaway (Listen, enthusiasm): a walkthrough written with Kural's real prompt (Haiku), read by every Supertonic 3 voice
// the way Listen reads it (sentence by sentence, Listen's text clean-up, expression tags kept). out/samples/voice-<V>.wav
const fs = require("fs"), path = require("path"), Module = require("module");
const orig = Module._load;
const vscode = { window: { createOutputChannel: () => ({ appendLine() {} }) }, workspace: { workspaceFolders: [], isTrusted: true, getConfiguration: () => ({ get: (k, d) => d, inspect: () => undefined }), onDidChangeConfiguration: () => ({ dispose() {} }) },
  env: {}, commands: { executeCommand: async () => {} }, Uri: { file: (f) => ({ scheme: "file", fsPath: f }) }, EventEmitter: class { constructor() { this.event = () => {}; } fire() {} } };
Module._load = function (req, ...a) { return req === "vscode" ? vscode : orig.call(this, req, ...a); };
const EXT = path.join(__dirname, "../../extension");
require(EXT + "/lib/ai/claude.js").setSetupGate(() => true);
const brain = require(EXT + "/lib/ai");
const { writeScript } = require(EXT + "/lib/listen/script");
const { sentences, forVoice } = require(EXT + "/lib/listen/speech");
const { load } = require(EXT + "/lib/listen/engines/supertonic");
const { wav } = require("./kp");
const M = path.join(__dirname, "out/models/st3");
const BLOCKS = [
  { n: 0, kind: "p", text: "The login broke because the access token expired after an hour and nothing refreshed it." },
  { n: 1, kind: "p", text: "I changed the client so it keeps the refresh token and asks for a new access token a minute before the old one runs out." },
  { n: 2, kind: "code", text: "if (token.expiresAt - Date.now() < 60_000) {\n  token = await auth.refresh(token.refreshToken);\n}" },
  { n: 3, kind: "list", text: "- src/api/client.ts: the refresh check before each request\n- src/auth/store.ts: keeps the refresh token\n- test/client.test.ts: two new tests" },
  { n: 4, kind: "p", text: "Run npm test to check it; both new tests pass here." },
];
(async () => {
  const tags = ["laugh", "breath", "sigh"];
  const { pieces } = await writeScript({ model: "haiku", blocks: BLOCKS, request: "Why did the login break?", tags, onPiece: () => {},
    deps: { makeAgent: brain.makeAgent, isClaude: () => true, emptyDir: () => require("os").tmpdir(), cwd: () => process.cwd(), localOpts: () => null, mode: () => "ask" } });
  const text = pieces.map((p) => p.text).join(" ");
  fs.writeFileSync(path.join(__dirname, "out/walkthrough-lively.txt"), text);
  console.log(text, "\n");
  const ort = path.join(__dirname, "../../dist/tts-runtime-src/node_modules/onnxruntime-node");   // (not used: paths.ort below)
  void ort;
  for (const v of ["F1", "F2", "F3", "F4", "F5", "M1", "M2", "M3", "M4", "M5"]) {
    const voice = await load({ ort: require.resolve("onnxruntime-node"), dp: `${M}/onnx/duration_predictor.onnx`, te: `${M}/onnx/text_encoder.onnx`,
      ve: `${M}/onnx/vector_estimator.onnx`, voc: `${M}/onnx/vocoder.onnx`, cfg: `${M}/onnx/tts.json`, indexer: `${M}/onnx/unicode_indexer.json`,
      voice: `${M}/voice_styles/${v}.json` }, 4);
    const parts = [];
    for (const s of sentences(text)) { const pcm = await voice.speak(forVoice(s, tags)); parts.push(Float32Array.from(pcm, (x) => x / 32768)); }
    const all = new Float32Array(parts.reduce((n, p) => n + p.length, 0)); let at = 0;
    for (const p of parts) { all.set(p, at); at += p.length; }
    wav(path.join(__dirname, `out/samples/voice-${v}.wav`), all, voice.rate);
    console.log(`voice-${v}.wav ${(all.length / voice.rate).toFixed(1)} s`);
  }
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });

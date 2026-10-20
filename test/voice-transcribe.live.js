// Voice input, live: the real Whisper WebAssembly build and model on a real English recording (JFK, 11 s; also repeated
// 3 times, 33 s), with the time each takes. Not part of npm test: needs the build (scripts/whisper-wasm/build.sh) and the
// model. KURAL_WHISPER_DIR (default dist/whisper-wasm), KURAL_WHISPER_MODEL (default dist/ggml-base.en-q5_1.bin).
//   node test/voice-transcribe.live.js
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const DIR = process.env.KURAL_WHISPER_DIR || path.join(ROOT, "dist", "whisper-wasm");
const MODEL = process.env.KURAL_WHISPER_MODEL || path.join(ROOT, "dist", "ggml-base.en-q5_1.bin");
const WANT = "not what your country can do for you";   // (Whisper hears "ask" or "asked")
const threads = Math.min(8, Math.max(1, (os.availableParallelism ? os.availableParallelism() : os.cpus().length) - 1));

// 16-bit PCM WAV (16 kHz mono) → Float32Array in [-1, 1].
function readWav(file) {
  const b = fs.readFileSync(file);
  let at = 12;
  while (at + 8 <= b.length) {
    const id = b.toString("ascii", at, at + 4), size = b.readUInt32LE(at + 4);
    if (id === "data") {
      const n = size / 2, out = new Float32Array(n);
      for (let i = 0; i < n; i++) out[i] = b.readInt16LE(at + 8 + i * 2) / 32768;
      return out;
    }
    at += 8 + size + (size & 1);
  }
  throw new Error("no data chunk");
}
const words = (s) => s.toLowerCase().replace(/[^a-z ]+/g, " ").replace(/\s+/g, " ").trim();

(async () => {
  require("v8").setFlagsFromString("--no-liftoff");   // (as the helper does: optimized code from the first call)
  const createWhisper = require(path.join(DIR, "kural-whisper.js"));
  let t = Date.now();
  const w = await createWhisper({ print: () => {}, printErr: () => {} });
  assert.ok(w.init(new Uint8Array(fs.readFileSync(MODEL))), "the model loads");
  console.log(`loaded in ${Date.now() - t} ms (${threads} threads)`);
  const jfk = readWav(path.join(__dirname, "fixtures", "voice", "jfk.wav"));
  const three = new Float32Array(jfk.length * 3);
  for (let i = 0; i < 3; i++) three.set(jfk, i * jfk.length);
  for (const [name, pcm] of [["11 s", jfk], ["33 s", three]]) {
    t = Date.now();
    const text = w.transcribe(pcm, threads);
    const ms = Date.now() - t;
    console.log(`${name} of audio in ${ms} ms: ${text.trim()}`);
    assert.ok(words(text).includes(WANT), `"${WANT}" in: ${text}`);
  }
  w.free();
  // The same through Kural's helper process (lib/voice/transcriber.js), as Kural runs it: with Node, and with Kural's own
  // program as Node when KURAL_EXEC points at it (e.g. /usr/share/kural/kural).
  const { Transcriber } = require("../extension/lib/voice/transcriber");
  for (const execPath of [process.execPath, process.env.KURAL_EXEC].filter(Boolean)) {
    const tr = new Transcriber({ paths: () => ({ loader: path.join(DIR, "kural-whisper.js"), model: MODEL }), execPath, log: console.log });
    for (const label of ["first", "second"]) {
      t = Date.now();
      const r = await tr.transcribe(jfk);
      console.log(`helper (${path.basename(execPath)}), ${label}: ${Date.now() - t} ms in all, ${r.ms} ms Whisper: ${r.text}`);
      assert.ok(words(r.text).includes(WANT));
    }
    tr.stop();
  }
  console.log("voice-transcribe.live: ALL PASS");
  process.exit(0);
})().catch((e) => { console.error("FAIL", e.stack || e); process.exit(1); });

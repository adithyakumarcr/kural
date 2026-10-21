// Throwaway (Listen spike step 4): the same walkthrough read by each engine and voice, sentence by sentence (as Listen would),
// with a short pause between sentences. Writes out/samples/<engine>-<voice>.wav.
const fs = require("fs"), path = require("path");
process.env.ORT_NATIVE = "1";
const ort = require("onnxruntime-node");
const { loadSupertonic } = require("./st");
const { loadKokoro, loadPiper, wav } = require("./kp");
const text = fs.readFileSync(path.join(__dirname, "out/walkthrough.txt"), "utf8").trim();
const tagged = text.replace("pretty cool.", "pretty cool. <laugh>").replace("Then there's the design bugs.", "<breath> Then there's the design bugs.");
const sentences = (t) => t.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
const strip = (t) => t.replace(/<\/?[a-z]+>/g, "").replace(/\s+/g, " ").trim();
const runs = [
  ["supertonic3", "F1", () => loadSupertonic(ort, path.join(__dirname, "out/models/st3"), "F1", 3), tagged],
  ["supertonic3", "F2", () => loadSupertonic(ort, path.join(__dirname, "out/models/st3"), "F2", 3), tagged],
  ["supertonic3", "M1", () => loadSupertonic(ort, path.join(__dirname, "out/models/st3"), "M1", 3), tagged],
  ["supertonic3", "M2", () => loadSupertonic(ort, path.join(__dirname, "out/models/st3"), "M2", 3), tagged],
  ["supertonic3-notags", "F1", () => loadSupertonic(ort, path.join(__dirname, "out/models/st3"), "F1", 3), text],
  ["kokoro", "af_heart", () => loadKokoro(ort, { file: "model_fp16.onnx", voice: "af_heart", threads: 3 }), text],
  ["kokoro", "am_michael", () => loadKokoro(ort, { file: "model_fp16.onnx", voice: "am_michael", threads: 3 }), text],
  ["kokoro", "bm_george", () => loadKokoro(ort, { file: "model_fp16.onnx", voice: "bm_george", threads: 3 }), text],
  ["piper", "ljspeech", () => loadPiper(ort, { threads: 3 }), text],
];
(async () => {
  fs.mkdirSync(path.join(__dirname, "out/samples"), { recursive: true });
  for (const [engine, voice, load, src] of runs) {
    const e = await load(), parts = [];
    let first = null, made = 0;
    const t0 = Date.now();
    for (const s of sentences(src)) {
      const r = await e.speak(engine.startsWith("supertonic") ? s : strip(s));
      if (first === null) first = Date.now() - t0;
      parts.push(r.pcm, new Float32Array(Math.round(r.rate * 0.18)));
      made += r.pcm.length / r.rate;
    }
    const all = new Float32Array(parts.reduce((n, p) => n + p.length, 0)); let at = 0;
    for (const p of parts) { all.set(p, at); at += p.length; }
    const file = path.join(__dirname, "out/samples", `${engine}-${voice}.wav`);
    wav(file, all, e.rate);
    console.log(JSON.stringify({ engine, voice, firstSentenceMs: first, totalMs: Date.now() - t0, audioS: +made.toFixed(1), file }));
  }
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });

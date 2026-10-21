// Throwaway (Listen spike step 1): does onnxruntime-web use threads when run by Kural's own program as Node?
// ELECTRON_RUN_AS_NODE=1 /usr/share/kural/kural --no-liftoff ort-threads.js
const path = require("path");
const ort = require(process.env.ORT_NATIVE ? "onnxruntime-node" : "onnxruntime-web");
const { loadSupertonic } = require("./st");
const TEXT = "Alright, let me walk you through what this change does and why it matters.";
(async () => {
  for (const threads of (process.env.THREADS || "1,8").split(",").map(Number)) {
    const t0 = Date.now();
    const tts = await loadSupertonic(ort, path.join(__dirname, "out/models/st3"), "F1", threads);
    const load = Date.now() - t0;
    await tts.speak(TEXT);   // warm
    const t1 = Date.now(); const { pcm, rate } = await tts.speak(TEXT); const ms = Date.now() - t1;
    console.log(JSON.stringify({ threads, load, ms, audio: +(pcm.length / rate).toFixed(2), rtf: +(ms / 1000 / (pcm.length / rate)).toFixed(3) }));
  }
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });

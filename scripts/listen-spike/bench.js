// Throwaway (Listen spike step 3): one engine per run, timed. ENGINE=st3|kokoro-int8|kokoro-fp16|piper THREADS=n
// ELECTRON_RUN_AS_NODE=1 ORT_NATIVE=1 /usr/share/kural/kural --no-liftoff bench.js   (taskset -c 0-3 for the 4-core run)
const path = require("path");
process.env.ORT_NATIVE = "1";
const ort = require("onnxruntime-node");
const { loadSupertonic } = require("./st");
const { loadKokoro, loadPiper } = require("./kp");
const S10 = "Okay, so the login broke because the token expired.";
const S30 = "Here's the clever part: instead of asking the server every time, it keeps the token for an hour, and only when that runs out does it quietly fetch a fresh one in the background.";
const engine = process.env.ENGINE, threads = Number(process.env.THREADS) || 4;
const loaders = {
  st3: () => loadSupertonic(ort, path.join(__dirname, "out/models/st3"), "F1", threads),
  "kokoro-int8": () => loadKokoro(ort, { threads }),
  "kokoro-fp16": () => loadKokoro(ort, { file: "model_fp16.onnx", threads }),
  piper: () => loadPiper(ort, { threads }),
};
const time = async (f) => { const t = Date.now(); const r = await f(); return [Date.now() - t, r]; };
(async () => {
  const [load, e] = await time(loaders[engine]);
  const [cold10] = await time(() => e.speak(S10));
  const [warm10, r10] = await time(() => e.speak(S10));
  const [warm30, r30] = await time(() => e.speak(S30));
  const dur = (r) => r.pcm.length / r.rate;
  console.log(JSON.stringify({ engine, threads, load, cold10, warm10, warm30, audio10: +dur(r10).toFixed(2), audio30: +dur(r30).toFixed(2),
    speedx: +(dur(r30) / (warm30 / 1000)).toFixed(1), rssMB: Math.round(process.resourceUsage().maxRSS / 1024) }));
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });

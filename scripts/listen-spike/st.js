// Throwaway (Listen spike): Supertonic 3 with onnxruntime-web, ported from supertone-oss-archive/supertonic nodejs/helper.js (MIT).
const fs = require("fs"), path = require("path");

async function loadSupertonic(ort, dir, voice = "F1", threads = 8) {
  if (ort.env && ort.env.wasm) ort.env.wasm.numThreads = threads;
  const native = !!process.env.ORT_NATIVE;
  const onnx = path.join(dir, "onnx");
  const cfg = JSON.parse(fs.readFileSync(path.join(onnx, "tts.json"), "utf8"));
  const indexer = JSON.parse(fs.readFileSync(path.join(onnx, "unicode_indexer.json"), "utf8"));
  const sess = async (n) => ort.InferenceSession.create(fs.readFileSync(path.join(onnx, `${n}.onnx`)), native ? { intraOpNumThreads: threads, interOpNumThreads: 1, graphOptimizationLevel: "all" } : { executionProviders: ["wasm"] });
  const [dp, te, ve, voc] = [await sess("duration_predictor"), await sess("text_encoder"), await sess("vector_estimator"), await sess("vocoder")];
  const st = JSON.parse(fs.readFileSync(path.join(dir, "voice_styles", `${voice}.json`), "utf8"));
  const ttl = new ort.Tensor("float32", Float32Array.from(st.style_ttl.data.flat(Infinity)), st.style_ttl.dims);
  const dps = new ort.Tensor("float32", Float32Array.from(st.style_dp.data.flat(Infinity)), st.style_dp.dims);
  const rate = cfg.ae.sample_rate, base = cfg.ae.base_chunk_size, ccf = cfg.ttl.chunk_compress_factor, ldim = cfg.ttl.latent_dim;

  const prep = (text) => {
    text = text.normalize("NFKD").replace(/\s+/g, " ").trim();
    if (!/[.!?;:,'")\]}…]$/.test(text)) text += ".";
    return `<en>${text}</en>`;
  };
  async function speak(text, steps = 5, speed = 1.05) {
    const t = prep(text), ids = Array.from(t).map((c) => indexer[c.charCodeAt(0)] || 0), L = ids.length;
    const tid = new ort.Tensor("int64", BigInt64Array.from(ids.map(BigInt)), [1, L]);
    const tmask = new ort.Tensor("float32", new Float32Array(L).fill(1), [1, 1, L]);
    const dur = (await dp.run({ text_ids: tid, style_dp: dps, text_mask: tmask })).duration.data[0] / speed;
    const emb = (await te.run({ text_ids: tid, style_ttl: ttl, text_mask: tmask })).text_emb;
    const wavLen = Math.floor(dur * rate), chunk = base * ccf, latLen = Math.floor((wavLen + chunk - 1) / chunk), D = ldim * ccf;
    let lat = new Float32Array(D * latLen);
    for (let i = 0; i < lat.length; i++) { const u1 = Math.max(1e-10, Math.random()), u2 = Math.random(); lat[i] = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2); }
    const lmask = new ort.Tensor("float32", new Float32Array(latLen).fill(1), [1, 1, latLen]);
    const total = new ort.Tensor("float32", Float32Array.of(steps), [1]);
    for (let s = 0; s < steps; s++) {
      const r = await ve.run({ noisy_latent: new ort.Tensor("float32", lat, [1, D, latLen]), text_emb: emb, style_ttl: ttl, text_mask: tmask,
        latent_mask: lmask, total_step: total, current_step: new ort.Tensor("float32", Float32Array.of(s), [1]) });
      lat = Float32Array.from(r.denoised_latent.data);
    }
    const wav = (await voc.run({ latent: new ort.Tensor("float32", lat, [1, D, latLen]) })).wav_tts.data;
    return { pcm: Float32Array.from(wav.subarray(0, Math.min(wav.length, wavLen))), rate };
  }
  return { speak, rate };
}
module.exports = { loadSupertonic };

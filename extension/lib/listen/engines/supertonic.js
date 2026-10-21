// Listen's voice engine: Supertonic 3 (Supertone; weights OpenRAIL-M) on ONNX Runtime for Node, inside the voice helper
// (no vscode). Adapted from Supertone's Node example (supertone-oss-archive/supertonic nodejs/helper.js, MIT): text →
// characters (no phonemizer) → duration predictor → text encoder → 5 denoising steps → vocoder → 44.1 kHz audio.
const fs = require("fs");

const STEPS = 5, SPEED = 1.05, MAX_CHARS = 300;   // (SPEED: Supertone's own pace; Listen's 0.5x–2x multiplies it)
const REPLACE = [["–", "-"], ["‑", "-"], ["—", "-"], ["_", " "], ["“", '"'], ["”", '"'], ["‘", "'"], ["’", "'"],
  ["´", "'"], ["`", "'"], ["[", " "], ["]", " "], ["|", " "], ["/", " "], ["#", " "], ["→", " "], ["←", " "], ["@", " at "],
  ["e.g.,", "for example, "], ["i.e.,", "that is, "]];

// What the model reads: Supertone's own clean-up, then the language tag.
function prepare(text) {
  let t = String(text || "").normalize("NFKD").replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, "");
  for (const [a, b] of REPLACE) t = t.split(a).join(b);
  t = t.replace(/[♥☆♡©\\]/g, "").replace(/\s+([,.!?;:'])/g, "$1").replace(/\s+/g, " ").trim();
  if (!t) return "";
  if (!/[.!?;:,'")\]}…]$/.test(t)) t += ".";
  return `<en>${t}</en>`;
}

// Long text in parts of at most MAX_CHARS, at sentence ends (Listen sends one sentence, so usually one part).
function parts(text) {
  const out = [];
  let cur = "";
  for (const s of String(text).split(/(?<=[.!?])\s+/)) {
    if (cur && cur.length + s.length + 1 > MAX_CHARS) { out.push(cur); cur = ""; }
    cur = cur ? `${cur} ${s}` : s;
    while (cur.length > MAX_CHARS) { out.push(cur.slice(0, MAX_CHARS)); cur = cur.slice(MAX_CHARS); }
  }
  if (cur.trim()) out.push(cur);
  return out;
}

const normal = () => { const u1 = Math.max(1e-10, Math.random()), u2 = Math.random(); return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2); };

// paths: the files of lib/listen/assets.js by name (ort, binding, lib, dp, te, ve, voc, cfg, indexer, voice)
async function load(paths, threads = 1) {
  const ort = require(paths.ort);
  const opts = { intraOpNumThreads: threads, interOpNumThreads: 1, graphOptimizationLevel: "all" };
  const cfg = JSON.parse(fs.readFileSync(paths.cfg, "utf8"));
  const indexer = JSON.parse(fs.readFileSync(paths.indexer, "utf8"));
  const sessions = await Promise.all([paths.dp, paths.te, paths.ve, paths.voc].map((p) => ort.InferenceSession.create(p, opts)));
  const style = JSON.parse(fs.readFileSync(paths.voice, "utf8"));
  const ttl = new ort.Tensor("float32", Float32Array.from(style.style_ttl.data.flat(Infinity)), style.style_ttl.dims);
  const sdp = new ort.Tensor("float32", Float32Array.from(style.style_dp.data.flat(Infinity)), style.style_dp.dims);
  const rate = cfg.ae.sample_rate, chunk = cfg.ae.base_chunk_size * cfg.ttl.chunk_compress_factor, dim = cfg.ttl.latent_dim * cfg.ttl.chunk_compress_factor;
  const [sDp, sTe, sVe, sVoc] = sessions;

  async function one(text, speed) {
    const t = prepare(text);
    if (!t) return new Float32Array(0);
    const ids = Array.from(t).map((c) => indexer[c.charCodeAt(0)] || 0), L = ids.length;
    const textIds = new ort.Tensor("int64", BigInt64Array.from(ids.map(BigInt)), [1, L]);
    const textMask = new ort.Tensor("float32", new Float32Array(L).fill(1), [1, 1, L]);
    const seconds = (await sDp.run({ text_ids: textIds, style_dp: sdp, text_mask: textMask })).duration.data[0] / (SPEED * speed);
    const emb = (await sTe.run({ text_ids: textIds, style_ttl: ttl, text_mask: textMask })).text_emb;
    const wavLen = Math.max(1, Math.floor(seconds * rate)), latLen = Math.max(1, Math.ceil(wavLen / chunk));
    let latent = new Float32Array(dim * latLen).map(normal);
    const latentMask = new ort.Tensor("float32", new Float32Array(latLen).fill(1), [1, 1, latLen]);
    const total = new ort.Tensor("float32", Float32Array.of(STEPS), [1]);
    for (let step = 0; step < STEPS; step++) {
      const r = await sVe.run({ noisy_latent: new ort.Tensor("float32", latent, [1, dim, latLen]), text_emb: emb, style_ttl: ttl,
        text_mask: textMask, latent_mask: latentMask, total_step: total, current_step: new ort.Tensor("float32", Float32Array.of(step), [1]) });
      latent = Float32Array.from(r.denoised_latent.data);
    }
    const wav = (await sVoc.run({ latent: new ort.Tensor("float32", latent, [1, dim, latLen]) })).wav_tts.data;
    return wav.subarray(0, Math.min(wav.length, wavLen));
  }

  async function speak(text, speed = 1) {
    const pace = Math.min(2, Math.max(0.5, Number(speed) || 1));
    const pieces = [];
    for (const p of parts(text)) pieces.push(await one(p, pace));
    const gap = pieces.length > 1 ? Math.round(rate * 0.15) : 0;
    const n = pieces.reduce((s, p) => s + p.length, 0) + gap * Math.max(0, pieces.length - 1);
    const out = new Int16Array(n);
    let at = 0;
    for (const p of pieces) {
      for (let i = 0; i < p.length; i++) out[at + i] = Math.round(Math.max(-1, Math.min(1, p[i])) * 32767);
      at += p.length + gap;
    }
    return out;
  }
  return { rate, speak };
}

module.exports = { load, prepare, parts };

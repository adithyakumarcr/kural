// Throwaway (Listen spike): Kokoro and Piper with the native onnxruntime-node + espeak-ng (the `phonemizer` package).
const fs = require("fs"), path = require("path");
const { phonemize } = require("phonemizer");
const M = path.join(__dirname, "out/models");

// espeak drops punctuation: phonemize the parts between punctuation and put it back (as kokoro-js does).
async function ipa(text) {
  const parts = text.split(/([.,!?;:—…]+)/);
  let out = "";
  for (const p of parts) {
    if (/^[.,!?;:—…]+$/.test(p)) out += p + " ";
    else if (p.trim()) out += (await phonemize(p.trim(), "en-us")).join(" ");
  }
  return out.replace(/\s+/g, " ").trim();
}

async function loadKokoro(ort, { file = "model_quantized.onnx", voice = "af_heart", threads = 4 } = {}) {
  const sess = await ort.InferenceSession.create(path.join(M, "kokoro/onnx", file), { intraOpNumThreads: threads, interOpNumThreads: 1, graphOptimizationLevel: "all" });
  const vocab = require(path.join(M, "kokoro/tokenizer.json")).model.vocab;
  const buf = fs.readFileSync(path.join(M, "kokoro/voices", `${voice}.bin`));
  const styles = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  async function speak(text) {
    const ph = await ipa(text);
    const ids = [0, ...Array.from(ph).map((c) => vocab[c]).filter((x) => x !== undefined), 0];
    const n = Math.min(ids.length - 2, 509);
    const style = styles.slice(n * 256, n * 256 + 256);
    const r = await sess.run({ input_ids: new ort.Tensor("int64", BigInt64Array.from(ids.map(BigInt)), [1, ids.length]),
      style: new ort.Tensor("float32", style, [1, 256]), speed: new ort.Tensor("float32", Float32Array.of(1), [1]) });
    return { pcm: Float32Array.from(r.waveform.data), rate: 24000, ph };
  }
  return { speak, rate: 24000 };
}

async function loadPiper(ort, { threads = 4 } = {}) {
  const sess = await ort.InferenceSession.create(path.join(M, "piper/en_US-ljspeech-medium.onnx"), { intraOpNumThreads: threads, interOpNumThreads: 1, graphOptimizationLevel: "all" });
  const cfg = require(path.join(M, "piper/en_US-ljspeech-medium.onnx.json"));
  const map = cfg.phoneme_id_map, inf = cfg.inference;
  async function speak(text) {
    const ph = await ipa(text);
    const ids = [...map["^"], ...map["_"]];
    for (const c of Array.from(ph)) if (map[c]) ids.push(...map[c], ...map["_"]);
    ids.push(...map["$"]);
    const r = await sess.run({ input: new ort.Tensor("int64", BigInt64Array.from(ids.map(BigInt)), [1, ids.length]),
      input_lengths: new ort.Tensor("int64", BigInt64Array.of(BigInt(ids.length)), [1]),
      scales: new ort.Tensor("float32", Float32Array.of(inf.noise_scale, inf.length_scale, inf.noise_w), [3]) });
    return { pcm: Float32Array.from(r.output.data), rate: cfg.audio.sample_rate, ph };
  }
  return { speak, rate: cfg.audio.sample_rate };
}

function wav(file, pcm, rate) {
  const b = Buffer.alloc(44 + pcm.length * 2);
  b.write("RIFF", 0); b.writeUInt32LE(36 + pcm.length * 2, 4); b.write("WAVEfmt ", 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write("data", 36); b.writeUInt32LE(pcm.length * 2, 40);
  for (let i = 0; i < pcm.length; i++) b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, pcm[i])) * 32767), 44 + i * 2);
  fs.writeFileSync(file, b);
}
module.exports = { loadKokoro, loadPiper, ipa, wav };

// Voice input: the Whisper files Kural downloads the first time you use the mic (no vscode inside). Nothing about Whisper
// ships with Kural. Each file is pinned here by size and SHA-256: a download that doesn't match is deleted and refused.
//   - kural-whisper.js / .wasm: whisper.cpp 1.9.5 compiled to WebAssembly by scripts/whisper-wasm/build.sh, published on
//     this repo's release whisper-wasm-1.9.5 (.github/workflows/whisper-wasm.yml). The build is reproducible (a pinned
//     Emscripten image), so these hashes are also what scripts/whisper-wasm/build.sh makes; the workflow checks it.
//   - the model: Whisper base.en (English, already trained, used as is), quantized q5_1, from Hugging Face at a fixed commit.
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { downloadTo } = require("../update-net");

const RELEASE = "https://github.com/adithyakumarcr/kural/releases/download/whisper-wasm-1.9.5";
const HF = "https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1";
const FILES = [
  { name: "loader", file: "kural-whisper.js", url: `${RELEASE}/kural-whisper.js`, size: 101380,
    sha256: "7eef969b6dee059e92723fe90737fdf330b86920c6809d7c39ccb877f72cca75" },
  { name: "wasm", file: "kural-whisper.wasm", url: `${RELEASE}/kural-whisper.wasm`, size: 1255493,
    sha256: "73d3bf7f9e5c120fcc3be3c824160430c2f695733c186585a465c70e9d34ec72" },
  { name: "model", file: "ggml-base.en-q5_1.bin", url: `${HF}/ggml-base.en-q5_1.bin`, size: 59721011,
    sha256: "4baf70dd0d7c4247ba2b81fafd9c01005ac77c2f9ef064e00dcf195d0e2fdd2f" },
];
const totalOf = (files) => files.reduce((n, f) => n + f.size, 0);
const TOTAL_BYTES = totalOf(FILES);

function hashFile(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash("sha256");
    fs.createReadStream(file).on("error", reject).on("data", (d) => h.update(d)).on("end", () => resolve(h.digest("hex")));
  });
}
const mismatch = () => new Error("Whisper's download didn't match what Kural expects, so it was deleted. Try again later.");

class Assets {
  constructor(dir, { files = FILES, download = downloadTo } = {}) {
    this.dir = dir; this.files = files; this.downloadTo = download;
    this.checked = new Map();   // file -> "size:mtimeMs" whose hash was right (checked once per start)
  }

  paths() { return Object.fromEntries(this.files.map((f) => [f.name, path.join(this.dir, f.file)])); }

  // One file there with the right hash? The hash is read once; after that the same size and date are trusted.
  async fileOk(f) {
    const p = path.join(this.dir, f.file);
    let st;
    try { st = await fs.promises.stat(p); } catch { return false; }
    if (st.size !== f.size) { this.checked.delete(p); return false; }
    const key = `${st.size}:${Math.floor(st.mtimeMs)}`;
    if (this.checked.get(p) === key) return true;
    if (await hashFile(p) !== f.sha256) return false;
    this.checked.set(p, key);
    return true;
  }

  async ready() {
    for (const f of this.files) if (!(await this.fileOk(f))) return false;
    return true;
  }

  // Downloads what's missing, each to "<file>.part", checked, then renamed into place. onProgress(got, total) over all files.
  async download({ onProgress, signal } = {}) {
    await fs.promises.mkdir(this.dir, { recursive: true, mode: 0o700 });
    await fs.promises.chmod(this.dir, 0o700).catch(() => {});
    const total = totalOf(this.files);
    let done = 0;
    for (const f of this.files) {
      if (await this.fileOk(f)) { done += f.size; if (onProgress) onProgress(done, total); continue; }
      const dest = path.join(this.dir, f.file), part = `${dest}.part`;
      try {
        await this.downloadTo(f.url, part, { expectedSize: f.size, cancel: signal,
          onProgress: (got) => onProgress && onProgress(done + Math.min(got, f.size), total) });
        const st = await fs.promises.stat(part);
        if (st.size !== f.size || await hashFile(part) !== f.sha256) throw mismatch();
        await fs.promises.rename(part, dest);
      } catch (e) {
        await fs.promises.rm(part, { force: true });
        // (A file bigger than its pinned size is refused by downloadTo: the same mismatch for the user.)
        throw e && e.constructor && e.constructor.name === "TooBig" ? mismatch() : e;
      }
      done += f.size;
      if (onProgress) onProgress(done, total);
    }
  }

  async remove() {
    this.checked.clear();
    for (const f of this.files) {
      const p = path.join(this.dir, f.file);
      await fs.promises.rm(p, { force: true });
      await fs.promises.rm(`${p}.part`, { force: true });
    }
  }
}

module.exports = { Assets, FILES, TOTAL_BYTES, hashFile };

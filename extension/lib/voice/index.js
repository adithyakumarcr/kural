// Voice input in the chat, the host side (no vscode inside: the chat wires it). The page records and sends 16 kHz mono
// samples in chunks; this asks to download Whisper the first time, transcribes on this computer, has the quickest model tidy
// the text up, and posts each phase to the page as voiceState {tabId, phase, …}:
//   ask → downloading {pct} → recording → transcribing → cleaning → done {raw, text, cleaned, why?, model?} | error {message}
// One recording per window at a time. The audio stays in memory for that recording only; it's never written to disk.
const { Assets } = require("./assets");
const { Transcriber, isBlank } = require("./transcriber");
const { cleanup: tidy } = require("./cleanup");

const RATE = 16000;
const MAX_SAMPLES = 5 * 60 * RATE;   // 5 minutes

const toFloats = (s) => s instanceof Float32Array ? s : s instanceof ArrayBuffer ? new Float32Array(s)
  : ArrayBuffer.isView(s) ? new Float32Array(s.buffer, s.byteOffset, s.byteLength / 4) : Float32Array.from(Array.isArray(s) ? s : []);

class Voice {
  // dir: <globalStorage>/voice · post(msg) to the chat's pages · cleanupDeps: Side chat's model deps (lib/voice/cleanup.js)
  // (assets / transcriber / cleanup: stand-ins in tests)
  constructor({ dir, post, cleanupDeps, log = () => {}, assets, transcriber, cleanup }) {
    this.post = post; this.log = log;
    this.assets = assets || new Assets(dir);
    this.transcriber = transcriber || new Transcriber({ paths: () => this.assets.paths(), log });
    this.tidy = cleanup || ((text) => tidy(text, cleanupDeps));
    this.rec = null;        // {tabId, chunks: Map<seq, Float32Array>}
    this.busy = null;       // tabId while transcribing / cleaning
    this.fetching = null;   // {tabId, ctl} while downloading
  }

  state(tabId, phase, more = {}) { this.post({ type: "voiceState", tabId, phase, ...more }); }

  // The mic was clicked: record, or first ask to download Whisper.
  async start(tabId) {
    if ((this.rec && this.rec.tabId !== tabId) || (this.busy && this.busy !== tabId)) return this.state(tabId, "error", { message: "Already recording in another chat." });
    if (this.fetching) return this.state(tabId, "downloading", { pct: this.fetching.pct || 0 });
    if (!(await this.assets.ready())) return this.state(tabId, "ask");
    this.record(tabId);
  }

  record(tabId) {
    this.rec = { tabId, chunks: new Map() };
    this.transcriber.warm();   // (Whisper loads while you talk)
    this.state(tabId, "recording");
  }

  async download(tabId) {
    if (this.fetching) return;
    const ctl = new AbortController(), job = { tabId, ctl, pct: 0 };
    this.fetching = job;
    try {
      await this.assets.download({ signal: ctl.signal, onProgress: (got, total) => {
        const pct = total ? Math.floor(got * 100 / total) : 0;
        if (pct === job.pct && pct !== 0) return;
        job.pct = pct; this.state(tabId, "downloading", { pct });
      } });
      this.fetching = null;
      this.log("voice: Whisper downloaded");
      this.record(tabId);
    } catch (e) {
      this.fetching = null;
      if (ctl.signal.aborted) return this.state(tabId, "idle");
      this.log(`voice: download failed: ${e.message}`);
      this.state(tabId, "error", { message: `Couldn't download Whisper: ${e.message}`, retry: true });
    }
  }

  stopDownload() { if (this.fetching) this.fetching.ctl.abort(); }

  chunk(tabId, seq, samples) {
    if (!this.rec || this.rec.tabId !== tabId || !Number.isInteger(seq) || seq < 0) return;
    this.rec.chunks.set(seq, toFloats(samples));
  }

  // Recording stopped: the samples in order (at most 5 minutes) → Whisper → cleanup → the page.
  async finish(tabId) {
    const rec = this.rec;
    if (!rec || rec.tabId !== tabId) return;
    this.rec = null;
    const parts = [...rec.chunks.entries()].sort((a, b) => a[0] - b[0]).map((e) => e[1]);
    const n = Math.min(MAX_SAMPLES, parts.reduce((s, p) => s + p.length, 0));
    const pcm = new Float32Array(n);
    let at = 0;
    for (const p of parts) { if (at >= n) break; const take = p.subarray(0, n - at); pcm.set(take, at); at += take.length; }
    rec.chunks.clear();
    this.busy = tabId;
    try {
      this.state(tabId, "transcribing");
      const { text: raw, ms } = await this.transcriber.transcribe(pcm);
      this.log(`voice: ${(n / RATE).toFixed(1)} s of speech transcribed in ${ms} ms`);
      if (this.busy !== tabId) return;   // (cancelled meanwhile)
      if (isBlank(raw)) return this.state(tabId, "error", { message: "No speech heard. Try again a little closer to the microphone." });
      this.state(tabId, "cleaning");
      const r = await this.tidy(raw);
      if (this.busy !== tabId) return;
      this.state(tabId, "done", { raw, text: r.text, cleaned: !!r.cleaned, ...(r.why ? { why: r.why } : {}), ...(r.model ? { model: r.model } : {}) });
    } catch (e) {
      this.log(`voice: ${e.message}`);
      if (this.busy === tabId) this.state(tabId, "error", { message: `Couldn't transcribe: ${e.message}` });
    } finally { if (this.busy === tabId) this.busy = null; }
  }

  cancel(tabId) {
    if (this.rec && this.rec.tabId === tabId) { this.rec.chunks.clear(); this.rec = null; }
    if (this.busy === tabId) this.busy = null;   // (a result still on its way is dropped)
  }

  // The chat tab closed: as cancel, and a download it started goes on (it's for every chat).
  closed(tabId) { this.cancel(tabId); }

  dispose() { this.stopDownload(); this.rec = null; this.busy = null; this.transcriber.stop(); }
}

module.exports = { Voice, MAX_SAMPLES, RATE };

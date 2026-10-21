// Listen, the host side (no vscode inside: the chat wires it). The page sends the answer's numbered blocks; a quick model
// writes a short spoken walkthrough as pieces (script.js), each piece is split into sentences (speech.js) and the voice
// helper (speaker.js) turns each sentence into audio, which goes to the page that asked, and only there:
//   listenState {tabId, index, phase: ask {size, model} | downloading {pct} | preparing | playing | stopped | error {message}}
//   listenAudio {tabId, index, seq, block, text, pcm Int16Array, rate, opener?}   (block null for the opener)
//   listenEnd   {tabId, index, partial?}
// One at a time in the window. A finished walkthrough is saved on the answer (msg.listen); the audio never is.
const fs = require("fs");
const path = require("path");
const { assetsFor, totalBytes, supported, ENGINES } = require("./assets");
const { Speaker } = require("./speaker");
const { writeScript } = require("./script");
const { sentences, forVoice } = require("./speech");

// Played at once the first time an answer is listened to, while the walkthrough is being written. Made with the voice
// right after the download and kept as files (openers/<i>.pcm, Int16, and openers/rate).
const OPENERS = ["Alright, let me walk you through this.", "Okay, here's the short version.", "Right, let's go through it.",
  "So, here's what's going on.", "Okay, let me explain."];
const CLOSING = "That's all I could put together.";
const VOICE_STOPPED = "The voice stopped. Try again.";
const NO_VOICE = "Listen's voice isn't available for this computer yet.";

// What the page sent, made safe for the prompt: numbered again, known kinds only, plain text of a sane size.
const KINDS = new Set(["p", "list", "code", "table", "heading"]);
const MAX_BLOCKS = 400, MAX_BLOCK_TEXT = 20000;
const cleanBlocks = (blocks) => (Array.isArray(blocks) ? blocks : []).slice(0, MAX_BLOCKS).map((b, n) => ({
  n, kind: b && KINDS.has(b.kind) ? b.kind : "p", text: b && typeof b.text === "string" ? b.text.slice(0, MAX_BLOCK_TEXT) : "" }));

const validListen = (l) => !!l && Array.isArray(l.pieces) && l.pieces.length > 0
  && l.pieces.every((p) => p && Number.isInteger(p.block) && p.block >= 0 && typeof p.text === "string");

class Listen {
  // dir: <globalStorage>/listen · postTo(pane, msg) · save() · pick(tab) → {model} | {why} · nameOf(model) ·
  // scriptDeps: Side chat's model deps · (speaker / assets / write / platform: stand-ins in tests)
  constructor({ dir, engine = "supertonic", postTo, save, pick, nameOf, scriptDeps, log = () => {}, speaker, assets, write, platform }) {
    Object.assign(this, { dir, engine, postTo, save, pick, nameOf, scriptDeps, log });
    this.platform = platform || [process.platform, process.arch];
    this.assets = assets || assetsFor(dir, engine);
    this.speaker = speaker || new Speaker({ engine, paths: () => this.assets.paths(), log });
    this.write = write || writeScript;
    this.tags = ENGINES[engine].tags;
    this.job = null;        // {pane, tab, msg, ctl, seq, pieces, chain, ended, playing}
    this.pending = null;    // a start waiting for the download: {pane, tab, index, blocks}
    this.fetching = null;   // {ctl, pct}
    this.making = null;     // the openers being made
  }

  // "" when Listen can run in this chat, else why not (the button's hover).
  why(tab) {
    if (!supported(this.engine, ...this.platform)) return NO_VOICE;
    const p = this.pick(tab);
    return (p && p.why) || "";
  }

  warm() { Promise.resolve(this.assets.ready()).then((ok) => { if (ok) this.speaker.warm(); }, () => {}); }

  state(pane, tab, index, phase, more = {}) { this.postTo(pane, { type: "listenState", tabId: tab.id, index, phase, ...more }); }

  async start(pane, tab, index, blocks) {
    const msg = tab && tab.messages[index];
    if (!msg || msg.role !== "assistant" || msg.running || tab.visiting) return;
    const cur = this.job;
    if (cur && cur.tab.id === tab.id && cur.msg === msg) return this.end(cur, "stopped");   // (the button is a toggle)
    if (cur) this.end(cur, "stopped");
    const why = this.why(tab);
    if (why) return this.state(pane, tab, index, "error", { message: why });
    const { model } = this.pick(tab);
    if (!(await this.assets.ready())) {
      this.pending = { pane, tab, index, blocks };
      return this.state(pane, tab, index, "ask", { size: totalBytes(this.engine, ...this.platform), model: this.nameOf(model) });
    }
    if (tab.messages[index] !== msg || (this.job && this.job !== cur)) return;   // (changed while checking)
    this.run(pane, tab, msg, cleanBlocks(blocks), model);
  }

  async run(pane, tab, msg, blocks, model) {
    const job = { pane, tab, msg, ctl: new AbortController(), seq: 0, pieces: [], chain: Promise.resolve(), ended: false, playing: false };
    this.job = job;
    const index = () => tab.messages.indexOf(msg);
    this.state(pane, tab, index(), "preparing");
    const saved = validListen(msg.listen) ? msg.listen.pieces : null;
    if (!saved) { const op = this.opener(); if (op) this.audio(job, { block: null, text: "", ...op, opener: true }); }
    const enqueue = (piece) => {
      if (job.ended) return;
      job.pieces.push(piece);
      job.chain = job.chain.then(() => this.speakPiece(job, piece));
    };
    let failed = null;
    try {
      if (saved) saved.forEach(enqueue);
      else {
        const request = (() => { const prev = tab.messages[index() - 1]; return prev && prev.role === "user" ? (prev.segments || []).filter((s) => s.t === "text").map((s) => s.v).join("") : ""; })();
        await this.write({ model, blocks, request, tags: this.tags, deps: this.scriptDeps, onPiece: enqueue, signal: job.ctl.signal });
      }
    } catch (e) { if (job.ended || e.cancelled) return; failed = e; }
    await job.chain;
    if (job.ended) return;
    if (failed) {
      if (!job.pieces.length) return this.fail(job, failed.message);
      await this.speakText(job, null, CLOSING);
      if (job.ended) return;
      this.finish(job, { partial: true });
      return;
    }
    if (!saved) { msg.listen = { pieces: job.pieces.map((p) => ({ block: p.block, text: p.text })), model: this.nameOf(model), engine: this.engine, at: Date.now() }; this.save(); }
    this.finish(job, {});
  }

  async speakPiece(job, piece) {
    for (const s of sentences(piece.text)) {
      if (job.ended || !(await this.speakText(job, piece.block, s))) return;
    }
  }

  // false: the voice failed (the job has ended with an error) or was stopped.
  async speakText(job, block, sentence) {
    const say = forVoice(sentence, this.tags);
    if (!say.replace(/<[a-z]+>/g, "").trim()) return true;
    let r;
    try { r = await this.speaker.speak(say); } catch (e) {
      if (!job.ended && !e.cancelled) { this.log(`listen: ${e.message}`); this.fail(job, VOICE_STOPPED); }
      return false;
    }
    if (job.ended) return false;
    if (r.pcm.length) this.audio(job, { block, text: forVoice(sentence, []), pcm: r.pcm, rate: r.rate });
    return true;
  }

  audio(job, a) {
    const index = job.tab.messages.indexOf(job.msg);
    if (index < 0) return this.end(job);
    if (!job.playing) { job.playing = true; this.state(job.pane, job.tab, index, "playing"); }
    this.postTo(job.pane, { type: "listenAudio", tabId: job.tab.id, index, seq: job.seq++, ...a });
  }

  finish(job, more) {
    const index = job.tab.messages.indexOf(job.msg);
    job.ended = true;
    if (this.job === job) this.job = null;
    if (index >= 0) this.postTo(job.pane, { type: "listenEnd", tabId: job.tab.id, index, ...more });
  }

  fail(job, message) {
    const index = job.tab.messages.indexOf(job.msg);
    this.end(job);
    if (index >= 0) this.state(job.pane, job.tab, index, "error", { message });
  }

  // Stops a job: the model request, and the voice's queue. phase: tell its page (another Listen started, the toggle).
  end(job, phase) {
    if (!job || job.ended) return;
    job.ended = true;
    job.ctl.abort();
    this.speaker.cancel();
    if (this.job === job) this.job = null;
    const index = job.tab.messages.indexOf(job.msg);
    if (phase && index >= 0) this.state(job.pane, job.tab, index, phase);
  }

  stop(tabId, index) {
    const p = this.pending;
    if (p && p.tab.id === tabId && p.index === index) this.pending = null;
    const j = this.job;
    if (j && j.tab.id === tabId && j.tab.messages.indexOf(j.msg) === index) this.end(j);
  }

  paneGone(pane) {
    if (this.job && this.job.pane === pane) this.end(this.job);
    if (this.pending && this.pending.pane === pane) this.pending = null;
  }

  tabClosed(tabId) {
    if (this.job && this.job.tab.id === tabId) this.end(this.job);
    if (this.pending && this.pending.tab.id === tabId) this.pending = null;
  }

  // Messages were removed (Edit): stop if the answer being listened to is gone.
  cut(tab) { if (this.job && this.job.tab === tab && tab.messages.indexOf(this.job.msg) < 0) this.end(this.job); }

  async download(pane, tab) {
    if (this.fetching) return;
    const job = { ctl: new AbortController(), pct: -1 };
    this.fetching = job;
    const p = this.pending, index = p && p.tab === tab ? p.index : -1;
    try {
      await this.assets.download({ signal: job.ctl.signal, onProgress: (got, total) => {
        const pct = total ? Math.floor(got * 100 / total) : 0;
        if (pct === job.pct) return;
        job.pct = pct; this.state(pane, tab, index, "downloading", { pct });
      } });
      this.fetching = null;
      this.log("listen: the voice downloaded");
      this.state(pane, tab, index, "preparing");
      await this.makeOpeners().catch((e) => this.log(`listen: openers: ${e.message}`));
      const pd = this.pending; this.pending = null;
      if (pd) await this.start(pd.pane, pd.tab, pd.index, pd.blocks);
    } catch (e) {
      this.fetching = null;
      if (job.ctl.signal.aborted) return this.state(pane, tab, index, "stopped");
      this.log(`listen: download failed: ${e.message}`);
      this.state(pane, tab, index, "error", { message: `Couldn't download the voice: ${e.message}` });
    }
  }

  stopDownload() { if (this.fetching) this.fetching.ctl.abort(); }

  openersDir() { return path.join(this.dir, "openers"); }

  makeOpeners() {
    if (this.making) return this.making;
    this.making = (async () => {
      const dir = this.openersDir();
      await fs.promises.mkdir(dir, { recursive: true, mode: 0o700 });
      let rate = 0;
      for (let i = 0; i < OPENERS.length; i++) {
        const r = await this.speaker.speak(forVoice(OPENERS[i], []));
        rate = r.rate;
        await fs.promises.writeFile(path.join(dir, `${i}.pcm`), Buffer.from(r.pcm.buffer, r.pcm.byteOffset, r.pcm.byteLength));
      }
      await fs.promises.writeFile(path.join(dir, "rate"), String(rate));
    })().finally(() => { this.making = null; });
    return this.making;
  }

  // A random opener from disk, or null (none made yet: they're made now, for next time).
  opener() {
    try {
      const dir = this.openersDir(), rate = Number(fs.readFileSync(path.join(dir, "rate"), "utf8"));
      const b = fs.readFileSync(path.join(dir, `${Math.floor(Math.random() * OPENERS.length)}.pcm`));
      const pcm = new Int16Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength - (b.byteLength % 2)));
      return rate > 0 && pcm.length ? { pcm, rate } : null;
    } catch {
      Promise.resolve(this.assets.ready()).then((ok) => ok && !this.job && this.makeOpeners()).catch(() => {});
      return null;
    }
  }

  dispose() { this.stopDownload(); if (this.job) this.end(this.job); this.pending = null; this.speaker.stop(); }

  // A saved chat: drop walkthroughs that aren't the right shape.
  static clean(messages) { for (const m of messages || []) if (m && "listen" in m && !validListen(m.listen)) delete m.listen; }
}

module.exports = { Listen, OPENERS, CLOSING, VOICE_STOPPED, NO_VOICE };

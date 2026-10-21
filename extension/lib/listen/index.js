// Listen, the host side (no vscode inside: the chat wires it). The page sends the answer's numbered blocks; a quick model
// writes a short spoken walkthrough as pieces (script.js), each piece is split into sentences (speech.js) and the voice
// helper (speaker.js) turns each sentence into audio, which goes to the page that asked, and only there:
//   listenState {tabId, index, phase: ask {size, model} | downloading {pct} | preparing | playing | stopped | error {message}}
//   listenAudio {tabId, index, seq, n, gen, block, text, pcm Int16Array, rate, opener?}
//     (n: the sentence's number; gen: bumped when the speed changes and the sentences from one on are made again, so
//     the page drops what it has from there; block null for the opener)
//   listenEnd   {tabId, index, partial?}
// One at a time in the window. A finished walkthrough is saved on the answer (msg.listen); the audio never is.
const fs = require("fs");
const path = require("path");
const { assetsFor, totalBytes, supported, ENGINES } = require("./assets");
const { Speaker } = require("./speaker");
const { writeScript } = require("./script");
const { sentences, forVoice } = require("./speech");

// Played at once the first time an answer is listened to, while the walkthrough is being written. Made with the voice
// right after the download and kept as files (openers/<i>.pcm, Int16, openers/rate, and openers/lines: the lines they
// say, so a change here makes them again). Lively but fitting any answer.
const OPENERS = ["Alright, let's dig in!", "Okay! Here's the short version.", "Right, let me walk you through it!",
  "So! Here's what's going on.", "Okay, let's go through this together!"];
const CLOSING = "That's all I could put together.";
const VOICE_STOPPED = "The voice stopped. Try again.";
const NO_VOICE = "Listen's voice isn't available for this computer yet.";
// The speeds in the bar's menu (the voice itself speaks faster or slower: the pitch stays natural).
const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];

// What the page sent, made safe for the prompt: numbered again, known kinds only, plain text of a sane size.
const KINDS = new Set(["p", "list", "code", "table", "heading"]);
const MAX_BLOCKS = 400, MAX_BLOCK_TEXT = 20000;
const cleanBlocks = (blocks) => (Array.isArray(blocks) ? blocks : []).slice(0, MAX_BLOCKS).map((b, n) => ({
  n, kind: b && KINDS.has(b.kind) ? b.kind : "p", text: b && typeof b.text === "string" ? b.text.slice(0, MAX_BLOCK_TEXT) : "" }));

const validListen = (l) => !!l && Array.isArray(l.pieces) && l.pieces.length > 0
  && l.pieces.every((p) => p && Number.isInteger(p.block) && p.block >= 0 && typeof p.text === "string");

class Listen {
  // dir: <globalStorage>/listen · postTo(pane, msg) · save() · pick(tab) → {model} | {why} · nameOf(model) ·
  // scriptDeps: Side chat's model deps · speed() / setSpeed(v): your default speed (kept by the chat) ·
  // (speaker / assets / write / platform: stand-ins in tests)
  constructor({ dir, engine = "supertonic", postTo, save, pick, nameOf, scriptDeps, log = () => {}, speaker, assets, write, platform,
    speed = () => 1, setSpeed = () => {} }) {
    Object.assign(this, { dir, engine, postTo, save, pick, nameOf, scriptDeps, log, getSpeed: speed, saveSpeed: setSpeed });
    this.platform = platform || [process.platform, process.arch];
    this.assets = assets || assetsFor(dir, engine);
    this.speaker = speaker || new Speaker({ engine, paths: () => this.assets.paths(), log });
    this.write = write || writeScript;
    this.tags = ENGINES[engine].tags;
    this.job = null;        // {pane, tab, msg, ctl, seq, pieces, sentences, next, gen, speed, pumping, ended, playing}
    this.pending = null;    // a start waiting for the download: {pane, tab, index, blocks}
    this.fetching = null;   // {ctl, pct}
    this.making = null;     // the openers being made
    this.done = null;       // the last job whose sentences are all made: its page may still be playing them (a speed change
                            // then makes them again from where it is)
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
    const job = { pane, tab, msg, ctl: new AbortController(), seq: 0, pieces: [], sentences: [], next: 0, gen: 0, speed: this.speed(),
      pumping: null, ended: false, playing: false };
    this.job = job;
    const index = () => tab.messages.indexOf(msg);
    this.state(pane, tab, index(), "preparing", { speed: job.speed });
    const saved = validListen(msg.listen) ? msg.listen.pieces : null;
    if (!saved) { const op = this.opener(); if (op) this.audio(job, { block: null, ...op, opener: true }); }
    const enqueue = (piece) => {
      if (job.ended) return;
      job.pieces.push(piece);
      for (const s of sentences(piece.text)) job.sentences.push({ block: piece.block, text: s });
      this.pump(job);
    };
    let failed = null;
    try {
      if (saved) saved.forEach(enqueue);
      else {
        const request = (() => { const prev = tab.messages[index() - 1]; return prev && prev.role === "user" ? (prev.segments || []).filter((s) => s.t === "text").map((s) => s.v).join("") : ""; })();
        await this.write({ model, blocks, request, tags: this.tags, deps: this.scriptDeps, onPiece: enqueue, signal: job.ctl.signal });
      }
    } catch (e) { if (job.ended || e.cancelled) return; failed = e; }
    await this.drain(job);
    if (job.ended) return;
    if (failed) {
      if (!job.pieces.length) return this.fail(job, failed.message);
      job.sentences.push({ block: null, text: CLOSING });
      await this.drain(job);
      if (job.ended) return;
      this.finish(job, { partial: true });
      return;
    }
    if (!saved) { msg.listen = { pieces: job.pieces.map((p) => ({ block: p.block, text: p.text })), model: this.nameOf(model), engine: this.engine, at: Date.now() }; this.save(); }
    this.finish(job, {});
  }

  // Speaks the sentences in order, one at a time, from job.next. A speed change (setSpeed) moves job.next back and bumps
  // job.gen: what was being made at the old speed is dropped and the loop goes on from there.
  pump(job) {
    if (job.pumping || job.ended) return;
    job.pumping = (async () => {
      while (!job.ended && job.next < job.sentences.length) {
        const n = job.next, gen = job.gen, s = job.sentences[n];
        const ok = await this.speakSentence(job, s, n, gen);
        if (job.ended) break;
        if (gen !== job.gen) continue;   // (the speed changed meanwhile: job.next was set again)
        if (!ok) break;
        job.next = n + 1;
      }
      job.pumping = null;
    })();
  }

  // Until every sentence so far is spoken (or the job ended).
  async drain(job) {
    for (;;) {
      if (job.pumping) { await job.pumping; continue; }
      if (!job.ended && job.next < job.sentences.length) { this.pump(job); continue; }
      return;
    }
  }

  // false: the voice failed (the job has ended with an error) or was stopped.
  async speakSentence(job, s, n, gen) {
    const say = forVoice(s.text, this.tags);
    if (!say.replace(/<[a-z]+>/g, "").trim()) return true;
    let r;
    try { r = await this.speaker.speak(say, { speed: job.speed }); } catch (e) {
      if (gen !== job.gen) return true;   // (cancelled for a new speed)
      if (!job.ended && !e.cancelled) { this.log(`listen: ${e.message}`); this.fail(job, VOICE_STOPPED); }
      return false;
    }
    if (job.ended) return false;
    if (gen !== job.gen) return true;
    if (r.pcm.length) this.audio(job, { n, gen, block: s.block, text: forVoice(s.text, []), pcm: r.pcm, rate: r.rate });
    return true;
  }

  speed() { const v = Number(this.getSpeed()); return SPEEDS.includes(v) ? v : 1; }

  // Everything was made but the page is still playing it: make the sentences from `from` again at the new speed (a job
  // of its own, with the same sentences and the next generation), then end again.
  async resume(old, speed, from) {
    const job = { ...old, ctl: new AbortController(), next: Math.max(0, Math.min(Number.isInteger(from) ? from : 0, old.sentences.length)),
      gen: old.gen + 1, speed, pumping: null, ended: false, playing: true };
    this.done = null;
    this.job = job;
    await this.drain(job);
    if (!job.ended) this.finish(job, {});
  }

  // The page's speed menu: kept as your default; the walkthrough playing goes on at it from sentence `from` (made again).
  setSpeed(tabId, index, speed, from) {
    const v = Number(speed);
    if (!SPEEDS.includes(v)) return;
    this.saveSpeed(v);
    const dn = this.done;
    if (!this.job && dn && dn.tab.id === tabId && dn.tab.messages.indexOf(dn.msg) === index && v !== dn.speed) return this.resume(dn, v, from);
    const j = this.job;
    if (!j || j.ended || j.tab.id !== tabId || j.tab.messages.indexOf(j.msg) !== index || v === j.speed) return;
    j.speed = v;
    j.gen++;
    j.next = Math.max(0, Math.min(Number.isInteger(from) ? from : j.next, j.sentences.length));
    this.speaker.cancel();
    this.pump(j);
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
    this.done = job;
    if (index >= 0) this.postTo(job.pane, { type: "listenEnd", tabId: job.tab.id, index, ...more });
    // No openers yet (their making failed after the download): make them now, while the voice is warm and idle.
    if (this.openersMissing) { this.openersMissing = false; this.makeOpeners().catch((e) => this.log(`listen: openers: ${e.message}`)); }
  }

  fail(job, message) {
    const index = job.tab.messages.indexOf(job.msg);
    this.end(job);
    if (index >= 0) this.state(job.pane, job.tab, index, "error", { message });
  }

  // Stops a job: the model request, and the voice's queue. phase: tell its page (another Listen started, the toggle).
  end(job, phase) {
    if (this.done && job && this.done.tab === job.tab && this.done.msg === job.msg) this.done = null;
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
    const dn = this.done;
    if (dn && dn.tab.id === tabId && dn.tab.messages.indexOf(dn.msg) === index) this.done = null;
    const j = this.job;
    if (j && j.tab.id === tabId && j.tab.messages.indexOf(j.msg) === index) this.end(j);
  }

  paneGone(pane) {
    if (this.done && this.done.pane === pane) this.done = null;
    if (this.job && this.job.pane === pane) this.end(this.job);
    if (this.pending && this.pending.pane === pane) this.pending = null;
  }

  tabClosed(tabId) {
    if (this.done && this.done.tab.id === tabId) this.done = null;
    if (this.job && this.job.tab.id === tabId) this.end(this.job);
    if (this.pending && this.pending.tab.id === tabId) this.pending = null;
  }

  // Messages were removed (Edit): stop if the answer being listened to is gone.
  cut(tab) {
    if (this.done && this.done.tab === tab && tab.messages.indexOf(this.done.msg) < 0) this.done = null;
    if (this.job && this.job.tab === tab && tab.messages.indexOf(this.job.msg) < 0) this.end(this.job);
  }

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
      await fs.promises.writeFile(path.join(dir, "lines"), JSON.stringify(OPENERS));
    })().finally(() => { this.making = null; });
    return this.making;
  }

  // A random opener from disk, or null (none made yet: they're made now, for next time).
  opener() {
    try {
      const dir = this.openersDir(), rate = Number(fs.readFileSync(path.join(dir, "rate"), "utf8"));
      if (fs.readFileSync(path.join(dir, "lines"), "utf8") !== JSON.stringify(OPENERS)) throw new Error("older lines");
      const i = Math.floor(Math.random() * OPENERS.length), b = fs.readFileSync(path.join(dir, `${i}.pcm`));
      const pcm = new Int16Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength - (b.byteLength % 2)));
      return rate > 0 && pcm.length ? { pcm, rate, text: OPENERS[i] } : null;
    } catch {
      this.openersMissing = true;   // (made when this walkthrough ends: finish())
      return null;
    }
  }

  dispose() { this.stopDownload(); if (this.job) this.end(this.job); this.pending = null; this.speaker.stop(); }

  // A saved chat: drop walkthroughs that aren't the right shape.
  static clean(messages) { for (const m of messages || []) if (m && "listen" in m && !validListen(m.listen)) delete m.listen; }
}

module.exports = { Listen, OPENERS, CLOSING, VOICE_STOPPED, NO_VOICE, SPEEDS };

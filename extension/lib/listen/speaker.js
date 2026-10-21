// Listen: the voice, in a helper process (no vscode inside). The helper (tts-worker.js, run by Kural's own program as Node:
// ELECTRON_RUN_AS_NODE) loads the voice model once and keeps it while you listen; it stops after `idleMs` without a
// request (the model takes ~770 MB). A crash fails that request only; the next one starts it again.
// Protocol over stdio, so the audio never touches the disk: a JSON line {"id", "text"} in; a JSON line
// {"id", "n", "rate", "ms"} followed by n little-endian Int16 samples out, or a JSON line {"id", "error"}.
// One request is in the helper at a time: what waits stays here, so cancel() drops it without the helper making it.
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const { killTree } = require("../ai/killtree");

const IDLE_MS = 5 * 60 * 1000;
// (8 threads were no faster than 3 in the spike: docs/benchmarks/listen-2026-10-21.md)
const threadCount = () => Math.min(4, Math.max(1, (os.availableParallelism ? os.availableParallelism() : os.cpus().length) - 1));
const cancelled = () => { const e = new Error("Stopped."); e.cancelled = true; return e; };

class Speaker {
  // engine: engines/<engine>.js · paths() → the voice's files by name · execPath: the program to run as Node · worker: the helper
  constructor({ engine, paths, execPath = process.execPath, worker = path.join(__dirname, "tts-worker.js"), idleMs = IDLE_MS, log = () => {} }) {
    Object.assign(this, { engine, paths, execPath, worker, idleMs, log });
    this.proc = null; this.queue = []; this.current = null; this.nextId = 1; this.idle = null;
  }

  start() {
    // (--no-liftoff: optimized WebAssembly/JS from the first request, as Whisper's helper)
    const p = spawn(this.execPath, ["--no-liftoff", this.worker, this.engine, JSON.stringify(this.paths()), String(threadCount())], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    this.proc = p;
    let buf = Buffer.alloc(0), head = null;
    p.stdout.on("data", (d) => {
      buf = Buffer.concat([buf, d]);
      for (;;) {
        if (!head) {
          const nl = buf.indexOf(10);
          if (nl < 0) return;
          try { head = JSON.parse(buf.subarray(0, nl).toString("utf8")); } catch { head = { id: 0, n: 0 }; }
          buf = buf.subarray(nl + 1);
          if (head.error || !(head.n > 0)) { this.answer(head, null); head = null; continue; }
        }
        if (buf.length < head.n * 2) return;
        const bytes = Buffer.from(buf.subarray(0, head.n * 2));   // (a copy: aligned, and the rest of buf can go)
        buf = buf.subarray(head.n * 2);
        const h = head; head = null;
        this.answer(h, new Int16Array(bytes.buffer, bytes.byteOffset, h.n));
      }
    });
    p.stderr.on("data", (d) => { for (const l of d.toString("utf8").split("\n")) if (l.trim()) this.log(`listen: voice: ${l.trim()}`); });
    const gone = (why) => {
      if (this.proc !== p) return;
      this.proc = null; clearTimeout(this.idle);
      const job = this.current; this.current = null;
      if (job) job.reject(new Error(`The voice stopped (${why}).`));
      this.next();
    };
    p.on("exit", (code, signal) => gone(signal || `exited with ${code}`));
    p.on("error", (e) => gone(e.message));
    p.stdin.on("error", () => {});   // (it ended: "exit" reports it)
    return p;
  }

  answer(head, pcm) {
    const job = this.current;
    if (!job || job.id !== head.id) return;   // (cancelled meanwhile: dropped)
    this.current = null;
    if (head.error) job.reject(new Error(head.error));
    else job.resolve({ pcm: pcm || new Int16Array(0), rate: head.rate, ms: head.ms || 0 });
    this.next();
  }

  next() {
    if (this.current || !this.queue.length) return this.armIdle();
    const job = this.queue.shift();
    let p;
    try { p = this.proc || this.start(); } catch (e) { job.reject(e); return this.next(); }
    this.current = job;
    p.stdin.write(`${JSON.stringify({ id: job.id, text: job.text })}\n`);
  }

  // text → {pcm Int16Array, rate, ms}
  speak(text) {
    clearTimeout(this.idle);
    return new Promise((resolve, reject) => {
      this.queue.push({ id: this.nextId++, text: String(text || ""), resolve, reject });
      this.next();
    });
  }

  // Loads the voice ahead of time (pointing at Listen), so the first sentence comes sooner. Errors show at speak.
  warm() { if (!this.proc) { try { this.start(); this.armIdle(); } catch { /* reported by speak */ } } }

  // Drops what waits, and the answer to what the helper is making now (it finishes it; nobody gets it).
  cancel() {
    const all = [...(this.current ? [this.current] : []), ...this.queue];
    this.queue = [];
    for (const job of all) job.reject(cancelled());
    // (The helper still answers the one it's making: a stand-in takes that answer, then the next request goes.)
    if (this.current) this.current = { id: this.current.id, resolve() {}, reject() {} };
  }

  armIdle() {
    clearTimeout(this.idle);
    if (this.current || this.queue.length) return;
    this.idle = setTimeout(() => this.stop(), this.idleMs);
    if (this.idle.unref) this.idle.unref();
  }

  stop() {
    clearTimeout(this.idle);
    const p = this.proc;
    this.proc = null;
    const job = this.current; this.current = null;
    if (job) job.reject(cancelled());
    for (const j of this.queue.splice(0)) j.reject(cancelled());
    if (p) killTree(p);
  }
}

module.exports = { Speaker, threadCount, IDLE_MS };

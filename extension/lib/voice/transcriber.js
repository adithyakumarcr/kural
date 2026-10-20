// Voice input: speech → text with Whisper, in a helper process (no vscode inside). The helper (whisper-worker.js, run by
// Kural's own program as Node: ELECTRON_RUN_AS_NODE) loads the WebAssembly build and the model once and keeps them while
// you use the mic; it stops after `idleMs` without a request (the model takes ~150 MB). A crash fails that request only.
// Protocol over stdio, so the audio never touches the disk: a JSON line {"id", "n"} and n Float32 samples (little-endian)
// in; one JSON line {"id", "text", "ms"} or {"id", "error"} out.
const { spawn } = require("child_process");
const os = require("os");
const path = require("path");
const { onText } = require("../utf8");
const { killTree } = require("../ai/killtree");

const IDLE_MS = 5 * 60 * 1000;
const threadCount = () => Math.min(8, Math.max(1, (os.availableParallelism ? os.availableParallelism() : os.cpus().length) - 1));

// What Whisper writes for silence or noise: nothing, or only tags like [BLANK_AUDIO], (music), [ Silence ].
const isBlank = (text) => !String(text || "").replace(/\[[^\]]*\]|\([^)]*\)/g, "").trim();

class Transcriber {
  // paths() → {loader, model} · execPath: the program to run as Node · worker: the helper script · log(line)
  constructor({ paths, execPath = process.execPath, worker = path.join(__dirname, "whisper-worker.js"), idleMs = IDLE_MS, log = () => {} }) {
    Object.assign(this, { paths, execPath, worker, idleMs, log });
    this.proc = null; this.pending = new Map(); this.nextId = 1; this.idle = null;
  }

  start() {
    const { loader, model } = this.paths();
    // (--no-liftoff: optimized WebAssembly from the first request, ~3 s instead of 15-18 s; see whisper-worker.js)
    const p = spawn(this.execPath, ["--no-liftoff", this.worker, loader, model, String(threadCount())], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    this.proc = p;
    let out = "";
    onText(p.stdout, (s) => {
      out += s;
      for (let nl; (nl = out.indexOf("\n")) >= 0;) {
        const line = out.slice(0, nl); out = out.slice(nl + 1);
        let m; try { m = JSON.parse(line); } catch { continue; }
        const job = this.pending.get(m.id);
        if (!job) continue;
        this.pending.delete(m.id);
        if (m.error) job.reject(new Error(m.error)); else job.resolve({ text: String(m.text || "").trim(), ms: m.ms || 0 });
      }
    });
    onText(p.stderr, (s) => { for (const l of s.split("\n")) if (l.trim()) this.log(`voice: whisper: ${l.trim()}`); });
    const gone = (why) => {
      if (this.proc === p) { this.proc = null; clearTimeout(this.idle); }
      for (const job of this.pending.values()) job.reject(new Error(`Whisper stopped (${why}).`));
      this.pending.clear();
    };
    p.on("exit", (code, signal) => gone(signal || `exited with ${code}`));
    p.on("error", (e) => gone(e.message));
    p.stdin.on("error", () => {});   // (it ended: "exit" reports it)
    return p;
  }

  // samples: Float32Array, 16 kHz mono → {text, ms}
  transcribe(samples) {
    clearTimeout(this.idle);
    const p = this.proc || this.start();
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const done = (fn) => (v) => { this.armIdle(); fn(v); };
      this.pending.set(id, { resolve: done(resolve), reject: done(reject) });
      p.stdin.write(`${JSON.stringify({ id, n: samples.length })}\n`);
      p.stdin.write(Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength));
    });
  }

  // Loads Whisper ahead of time (when recording starts), so the first answer comes sooner. Errors show at transcribe.
  warm() { if (!this.proc) { try { this.start(); this.armIdle(); } catch { /* reported by transcribe */ } } }

  armIdle() {
    clearTimeout(this.idle);
    if (this.pending.size) return;
    this.idle = setTimeout(() => this.stop(), this.idleMs);
    if (this.idle.unref) this.idle.unref();
  }

  stop() {
    clearTimeout(this.idle);
    const p = this.proc;
    this.proc = null;
    if (p) killTree(p);
  }
}

module.exports = { Transcriber, isBlank, threadCount };

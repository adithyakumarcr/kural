// Installing Ollama from Kural in one click (the Tab panel's Set up, Get started, the chat's "Get Ollama"): download
// Ollama's own build from ollama.com (percent), install it (percent), start it, wait until it answers. Before, Kural
// opened ollama.com/download in the browser and people had to install it themselves and come back.
// No vscode inside (test/ollama-install.test.js).
//   Mac:     Ollama-darwin.zip → Ollama.app in /Applications (~/Applications if that isn't writable), opened hidden.
//            The same as Ollama's install.sh, without the `ollama` command in /usr/local/bin: that needs a password,
//            and Kural talks to Ollama over HTTP.
//   Windows: OllamaSetup.exe /VERYSILENT (installs for this user, no administrator), then "ollama app.exe".
//            The setup reports no progress, so installing has no percent there.
//   Linux:   Ollama's install.sh needs root (a system service, GPU drivers), so it runs through pkexec (the system's
//            own password window); its output gives the download percent and the steps.

const fs = require("fs"), os = require("os"), path = require("path");
const { spawn } = require("child_process");
const { privateTmp } = require("../paths");

const BASE = "https://ollama.com/download";

// Linux: install.sh's steps after the download (its ">>> " lines) → how far installing is.
const LINUX_STEPS = [
  [/accessible in the PATH/i, 20], [/creating ollama user/i, 35], [/to (render|video) group/i, 45],
  [/current user to ollama group/i, 55], [/systemd service/i, 70], [/starting ollama service/i, 85],
  [/nvidia|cuda|amd gpu|rocm/i, 90], [/api is now available|install complete/i, 100],
];

// One piece of install.sh's output (a line, or curl's "\r######  45.3%") → what changed, or null.
function readLinux(piece) {
  const t = String(piece).replace(/\x1b\[[0-9;]*[A-Za-z]/g, "").trim();
  if (!t) return null;
  if (t.startsWith(">>>")) {
    const text = t.replace(/^>+\s*/, "");
    if (/^downloading/i.test(text)) return { phase: "download", note: text };
    if (/^(installing ollama to|cleaning up old)/i.test(text)) return { note: text };   // (said before its download)
    const step = LINUX_STEPS.find(([re]) => re.test(text));
    return { phase: "install", note: text, percent: step ? step[1] : undefined };
  }
  const pct = /(\d{1,3}(?:[.,]\d+)?)\s*%\s*$/.exec(t);
  if (pct && /^#|^\s*\d/.test(t)) return { percent: Math.min(100, Math.round(parseFloat(pct[1].replace(",", ".")))) };
  if (/^error/i.test(t)) return { error: t.replace(/^error:?\s*/i, "") };
  return null;
}

class OllamaInstaller {
  // isUp: () => Promise<boolean> (does Ollama answer?). The rest is for tests.
  constructor({ isUp, platform = process.platform, base = process.env.KURAL_OLLAMA_DOWNLOAD || BASE, appsDirs, run = spawn,
    log = () => {}, waitMs = 90000 } = {}) {
    Object.assign(this, { isUp, platform, base: base.replace(/\/$/, ""), run, log, waitMs });
    this.appsDirs = appsDirs || ["/Applications", path.join(os.homedir(), "Applications")];
    this.state = null;        // while installing: { phase: "download" | "install" | "start", percent, note }
    this.job = null;
    this.listeners = new Set();
  }

  onProgress(f) { this.listeners.add(f); return () => this.listeners.delete(f); }
  set(next) { this.state = { ...this.state, ...next }; for (const f of this.listeners) f(this.state); }

  // Where an installed Ollama is (to start it without downloading again), or null.
  installed() {
    const has = (p) => { try { return fs.existsSync(p) ? p : null; } catch { return null; } };
    if (this.platform === "darwin") return this.appsDirs.map((d) => has(path.join(d, "Ollama.app"))).find(Boolean) || null;
    if (this.platform === "win32") return has(path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "Programs", "Ollama", "ollama app.exe"));
    return ["/usr/local/bin/ollama", "/usr/bin/ollama"].map(has).find(Boolean) || null;
  }

  // Start Ollama if it's installed but not running; install it if it isn't there. One at a time (several places ask).
  install() {
    if (!this.job) {
      this.stopped = false;
      this.ctl = new AbortController();
      this.job = this.go().finally(() => { this.job = null; this.child = null; this.state = null; for (const f of this.listeners) f(null); });
    }
    return this.job;
  }

  stop() { this.stopped = true; if (this.ctl) this.ctl.abort(); if (this.child) try { this.child.kill(); } catch {} }

  async go() {
    if (await this.isUp()) return;
    const have = this.installed();
    if (have && this.platform !== "linux") {
      // (Linux: an installed Ollama runs as a system service; if that's stopped, installing again restarts it.)
      this.log(`ollama: starting the installed ${have}`);
      return this.start(have);
    }
    if (this.platform === "darwin") return this.mac();
    if (this.platform === "win32") return this.windows();
    if (this.platform === "linux") return this.linux();
    throw new Error(`Kural can't install Ollama on ${this.platform}`);
  }

  // A file from ollama.com, with the download percent.
  async download(name, url = `${this.base}/${name}`) {
    this.set({ phase: "download", percent: 0, note: `Downloading ${name}` });
    const file = path.join(privateTmp("ollama"), name);
    const res = await fetch(url, { signal: this.ctl.signal });
    if (!res.ok) throw new Error(`ollama.com answered ${res.status} for ${name}`);
    const total = Number(res.headers.get("content-length")) || 0;
    const out = fs.createWriteStream(file);
    const done = new Promise((resolve, reject) => { out.on("finish", resolve); out.on("error", reject); });
    let got = 0, shown = -1;
    try {
      const reader = res.body.getReader();
      for (;;) {
        const { value, done: end } = await reader.read();
        if (end) break;
        got += value.length;
        if (!out.write(Buffer.from(value))) await new Promise((r) => out.once("drain", r));
        const p = total ? Math.min(100, Math.floor(100 * got / total)) : 0;
        if (p !== shown) { shown = p; this.set({ percent: p }); }
      }
    } catch (e) { out.destroy(); throw this.stopped ? new Error("stopped") : e; }
    out.end();
    await done;
    if (total && got < total) throw new Error(`the download of ${name} stopped early`);
    this.log(`ollama: downloaded ${name} (${Math.round(got / 1e6)} MB)`);
    return file;
  }

  // Run a program; onOut gets its output as it comes. Resolves with the exit code.
  exec(cmd, args, onOut = () => {}, opts = {}) {
    return new Promise((resolve, reject) => {
      const p = this.child = this.run(cmd, args, { stdio: ["ignore", "pipe", "pipe"], cwd: os.tmpdir(), ...opts });
      if (p.stdout) p.stdout.on("data", (d) => onOut(String(d)));
      if (p.stderr) p.stderr.on("data", (d) => onOut(String(d)));
      p.on("error", reject);
      p.on("close", (code) => resolve(code));
    });
  }

  async mac() {
    const zip = await this.download("Ollama-darwin.zip");
    const dir = this.appsDirs.find((d) => { try { fs.mkdirSync(d, { recursive: true }); fs.accessSync(d, fs.constants.W_OK); return true; } catch { return false; } });
    if (!dir) throw new Error("no folder to install Ollama.app in (/Applications isn't writable)");
    this.set({ phase: "install", percent: 0, note: `Installing Ollama in ${dir}` });
    // Unpack next to its place (same disk, so the move is instant), counting the files: that's the install percent.
    const list = [];
    await this.exec("/usr/bin/unzip", ["-Z1", zip], (t) => list.push(...t.split("\n").filter(Boolean)));
    const total = Math.max(1, list.length);
    const stage = fs.mkdtempSync(path.join(dir, ".kural-ollama-"));
    try {
      let n = 0, buf = "";
      const code = await this.exec("/usr/bin/unzip", ["-o", zip, "-d", stage], (t) => {
        buf += t; const lines = buf.split("\n"); buf = lines.pop();
        n += lines.filter((l) => /^\s*(inflating|creating|extracting|linking):/.test(l)).length;
        this.set({ percent: Math.min(95, Math.floor(95 * n / total)) });
      });
      if (this.stopped) throw new Error("stopped");
      if (code !== 0 || !fs.existsSync(path.join(stage, "Ollama.app"))) throw new Error(`unpacking Ollama failed (unzip ${code})`);
      const app = path.join(dir, "Ollama.app");
      if (fs.existsSync(app)) {
        // An older Ollama: quit it first (Get started's "Update Ollama"), like Ollama's own install.sh.
        await this.exec("/usr/bin/pkill", ["-x", "Ollama"]).catch(() => {});
        fs.rmSync(app, { recursive: true, force: true });
      }
      fs.renameSync(path.join(stage, "Ollama.app"), app);
      this.set({ percent: 100 });
      this.log(`ollama: installed ${app}`);
      return this.start(app);
    } finally { fs.rmSync(stage, { recursive: true, force: true }); fs.rmSync(zip, { force: true }); }
  }

  async windows() {
    const setup = await this.download("OllamaSetup.exe");
    this.set({ phase: "install", percent: undefined, note: "Installing Ollama" });
    const code = await this.exec(setup, ["/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART", "/SP-"]);
    fs.rmSync(setup, { force: true });
    if (this.stopped) throw new Error("stopped");
    if (code !== 0) throw new Error(`Ollama's setup failed (${code})`);
    this.set({ percent: 100 });
    const app = this.installed();
    if (!app) throw new Error("Ollama's setup finished, but Kural can't find ollama app.exe");
    return this.start(app);
  }

  async linux() {
    const script = await this.download("install.sh", this.base.replace(/\/download$/, "") + "/install.sh");
    const root = process.getuid && process.getuid() === 0;
    this.set({ phase: "download", percent: 0, note: root ? "Downloading Ollama" : "Ollama installs for the whole computer: type your password in the window that opens" });
    let last = "", error = "", buf = "";
    const code = await this.exec(root ? "/bin/sh" : "pkexec", root ? [script] : ["/bin/sh", script], (t) => {
      buf += t; const parts = buf.split(/[\r\n]+/); buf = parts.pop();
      for (const piece of parts) {
        const r = readLinux(piece);
        if (!r) continue;
        if (r.error) error = r.error;
        if (r.note) last = r.note;
        // (Once installing, a later download (GPU libraries) keeps the bar where it is: never backwards.)
        if (r.phase === "download") { if (this.state.phase !== "install") this.set({ ...r, percent: 0 }); }
        else if (r.phase === "install") {
          const was = this.state.phase === "install" ? this.state.percent || 0 : 0;
          this.set({ ...r, percent: Math.max(was, r.percent || 0) });
        } else if (r.note) this.set({ note: r.note });
        else if (r.percent !== undefined && this.state.phase === "download") this.set({ percent: r.percent });
      }
    }).catch((e) => { throw e.code === "ENOENT" ? new Error("this computer has no pkexec to ask for the password") : e; });
    fs.rmSync(script, { force: true });
    if (this.stopped) throw new Error("stopped");
    if (code === 126 || code === 127) throw new Error("the password window was closed");
    if (code !== 0) throw new Error(error || `Ollama's installer failed (${code})${last ? `: ${last}` : ""}`);
    this.set({ phase: "install", percent: 100 });
    if (!(await this.waitUp(20000))) { const app = this.installed(); if (app) return this.start(app); }
    if (!(await this.waitUp(this.waitMs))) throw new Error("Ollama was installed but doesn't answer");
  }

  // Start Ollama and wait until it answers.
  async start(app) {
    this.set({ phase: "start", percent: undefined, note: "Starting Ollama" });
    const detached = { stdio: "ignore", detached: true, cwd: os.tmpdir() };
    const p = this.platform === "darwin" ? this.run("/usr/bin/open", ["-a", app, "--args", "hidden"], detached)
      : this.platform === "win32" ? this.run(app, [], { ...detached, windowsHide: true })
      : this.run(app, ["serve"], detached);
    if (p) { p.on("error", (e) => this.log(`ollama: couldn't start ${app}: ${e.message}`)); if (p.unref) p.unref(); }
    if (!(await this.waitUp(this.waitMs))) throw new Error("Ollama was started but doesn't answer");
    this.log("ollama: running");
  }

  async waitUp(ms) {
    const until = Date.now() + ms;
    while (Date.now() < until) {
      if (this.stopped) throw new Error("stopped");
      if (await this.isUp()) return true;
      await new Promise((r) => setTimeout(r, 1000));
    }
    return false;
  }
}

module.exports = { OllamaInstaller, readLinux };

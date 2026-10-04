// Tab completion with a small code model on your own computer, through Ollama (ollama.com).
// Why: Claude (even Haiku) takes 0.5–0.9 s per suggestion through Claude Code. A small model made for
// code completion, running locally, answers in a few hundred milliseconds or less, like Cursor's own tab model.
//
// The model fills in the middle: it sees the code before AND after the cursor and writes what goes
// between (Qwen2.5-Coder's <|fim_prefix|> / <|fim_suffix|> / <|fim_middle|> format).

const vscode = require("vscode");
const { log } = require("../ai/claude");

const LOCAL_MODELS = [
  { id: "qwen2.5-coder:0.5b-base", label: "0.5B · fastest", size: "~400 MB" },
  { id: "qwen2.5-coder:1.5b-base", label: "1.5B · recommended", size: "~1 GB" },
  { id: "qwen2.5-coder:3b-base", label: "3B · smarter", size: "~2 GB" },
];

const cfg = () => vscode.workspace.getConfiguration("kural");
const url = (p) => (cfg().get("tabCompletion.ollamaUrl") || "http://127.0.0.1:11434").replace(/\/$/, "") + p;
const model = () => cfg().get("tabCompletion.localModel") || LOCAL_MODELS[1].id;

async function http(path, body, { timeoutMs = 4000, signal } = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  if (signal) signal.addEventListener("abort", () => ctl.abort());
  try {
    const res = await fetch(url(path), body === undefined ? { signal: ctl.signal }
      : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: ctl.signal });
    if (!res.ok) throw new Error(`${res.status} ${await res.text().catch(() => "")}`.trim());
    return res;
  } finally { clearTimeout(t); }
}

class LocalEngine {
  constructor() {
    this.state = { running: false, hasModel: false, models: [], checkedAt: 0 };
    this.listeners = [];
    this.pulling = null;   // { model, percent, status }
    this.last = null;      // the last local result, shown in the Tab panel: { ms, ok, note }
  }

  note(ms, ok, note) { this.last = { ms, ok, note, at: Date.now() }; this.changed(); }

  onChange(f) { this.listeners.push(f); }
  changed() { for (const f of this.listeners) f(); }

  // Is Ollama running, and does it have the model? (Checked at most every few seconds.)
  async status(force = false) {
    if (!force && Date.now() - this.state.checkedAt < 5000) return this.state;
    let next;
    try {
      const res = await http("/api/tags", undefined, { timeoutMs: 800 });
      const models = ((await res.json()).models || []).map((m) => m.name);
      const want = model();
      next = { running: true, models, hasModel: models.some((m) => m === want || m === `${want}:latest`), checkedAt: Date.now() };
    } catch { next = { running: false, hasModel: false, models: [], checkedAt: Date.now() }; }
    const was = this.state;
    this.state = next;
    if (was.running !== next.running || was.hasModel !== next.hasModel) {
      log(`tab: local model ${next.hasModel ? `${model()} ready` : next.running ? `${model()} not downloaded` : "unavailable (Ollama not running)"}`);
      if (next.hasModel) this.warm();
      this.changed();
    }
    return next;
  }

  async ready() { const s = await this.status(); return s.running && s.hasModel; }

  // Load the model into memory now, so the first suggestion doesn't wait for it.
  warm() { http("/api/generate", { model: model(), prompt: "", keep_alive: "2h" }, { timeoutMs: 60000 }).catch(() => {}); }

  // One suggestion. prefix/suffix = the file before/after the cursor; oneLine when the cursor is in
  // the middle of a line. Returns text, or null on failure (logged and shown in the Tab panel).
  // Short context and few tokens on purpose: on a computer without a GPU every token costs time.
  async complete(prefix, suffix, token, oneLine = false) {
    const ctl = new AbortController();
    const sub = token && token.onCancellationRequested(() => ctl.abort());
    const t0 = Date.now();
    try {
      const res = await http("/api/generate", {
        model: model(), raw: true, stream: false, keep_alive: "2h",
        prompt: `<|fim_prefix|>${prefix}<|fim_suffix|>${suffix}<|fim_middle|>`,
        options: { temperature: 0, num_predict: oneLine ? 24 : 64,
          stop: ["<|endoftext|>", "<|fim_pad|>", "<|file_sep|>", "<|fim_prefix|>", "<|fim_suffix|>", "<|fim_middle|>", oneLine ? "\n" : "\n\n\n"] },
      }, { timeoutMs: 6000, signal: ctl.signal });
      const text = (await res.json()).response || "";
      const ms = Date.now() - t0;
      log(`tab: local model answered in ${ms} ms: ${JSON.stringify(text).slice(0, 100)}`);
      this.note(ms, !!text.trim(), text.trim() ? "" : "empty answer");
      return text;
    } catch (e) {
      if (ctl.signal.aborted && token && token.isCancellationRequested) return null;   // you kept typing
      const ms = Date.now() - t0;
      const why = /abort|timeout/i.test(e.message) ? `no answer within ${Math.round(ms / 1000)} s — too slow on this computer` : e.message;
      log(`tab: local model failed after ${ms} ms: ${why}`);
      this.note(ms, false, why);
      this.state.checkedAt = 0;
      return null;
    } finally { if (sub) sub.dispose(); }
  }

  // The Tab panel's "Test local model": one fixed completion, timed, with the raw answer.
  async test() {
    const t0 = Date.now();
    const out = await this.complete("def area(w: float, h: float) -> float:\n    ", "\n\nprint(area(2, 3))\n", null);
    const clean = out == null ? null : out.replace(/<\|[a-z_]+\|>/g, "");
    return { ms: Date.now() - t0, output: clean, ok: clean != null && !!clean.trim() };
  }

  // Download a model, reporting progress (0–100).
  async pull(name = model()) {
    if (this.pulling) return;
    this.pulling = { model: name, percent: 0, status: "starting" };
    this.changed();
    try {
      const res = await http("/api/pull", { model: name, name, stream: true }, { timeoutMs: 60 * 60 * 1000 });
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, i); buf = buf.slice(i + 1);
          let m; try { m = JSON.parse(line); } catch { continue; }
          if (m.error) throw new Error(m.error);
          this.pulling.status = m.status || this.pulling.status;
          if (m.total) this.pulling.percent = Math.round(100 * (m.completed || 0) / m.total);
          this.changed();
        }
      }
      log(`tab: downloaded ${name}`);
      vscode.window.setStatusBarMessage(`Tab Completion: ${name} downloaded — local suggestions are on`, 4000);
    } catch (e) {
      log(`tab: download failed: ${e.message}`);
      vscode.window.showErrorMessage(`Kural couldn't download ${name}: ${e.message}`);
    } finally {
      this.pulling = null;
      await this.status(true);
      this.changed();
    }
  }
}

// What the local model wrote -> what to show. It writes freely, so keep it to what belongs at the
// cursor: one line in the middle of a line, a few lines otherwise.
function tidyLocal(text, restOfLine) {
  let s = String(text || "").replace(/<\|[a-z_]+\|>/g, "");
  if (restOfLine.trim()) return s.split("\n")[0];
  s = s.replace(/\s+$/, "");
  const lines = s.split("\n");
  // Stop at a blank line once there's content (the model moving on to something else).
  const out = [];
  for (const l of lines) { if (!l.trim() && out.some((x) => x.trim())) break; out.push(l); if (out.length >= 8) break; }
  return out.join("\n");
}

// Opens a terminal with the official installer for this computer.
function installOllama() {
  if (process.platform === "linux") {
    const t = vscode.window.createTerminal({ name: "Install Ollama" });
    t.show();
    t.sendText("curl -fsSL https://ollama.com/install.sh | sh && echo 'Done. Back in Kural, click Check again in the Tab panel.'");
  } else {
    vscode.env.openExternal(vscode.Uri.parse("https://ollama.com/download"));
  }
}

module.exports = { LocalEngine, LOCAL_MODELS, tidyLocal, installOllama };

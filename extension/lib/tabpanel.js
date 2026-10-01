// "Kural Tab" panel at the bottom of the window: a real on/off switch, a draggable speed
// slider, the model, and how fast the last suggestions came. Opened by clicking "Tab" in the
// status bar. (A status bar hover can't hold a real slider; this panel can.)

const vscode = require("vscode");
const { fontScale } = require("./ui");
const { LOCAL_MODELS, installOllama } = require("./local");

const cfg = () => vscode.workspace.getConfiguration("kural");

class TabPanel {
  constructor(context, speeds, local) {
    this.context = context;
    this.speeds = speeds;
    this.local = local;
    this.view = null;
    this.times = [];   // recent suggestion times (ms)
    this.lastEngine = null;
    if (local) local.onChange(() => this.push());
  }

  register() {
    this.context.subscriptions.push(
      vscode.window.registerWebviewViewProvider("kural.tabPanel", this),
      vscode.workspace.onDidChangeConfiguration((e) => { if (e.affectsConfiguration("kural.tabCompletion")) this.push(); }),
    );
  }

  // Called by tab completion after each suggestion.
  timing(ms, engine) {
    if (engine !== this.lastEngine) this.times = [];   // compare like with like
    this.lastEngine = engine;
    this.times.push(ms); if (this.times.length > 20) this.times.shift(); this.push();
  }

  state() {
    const c = cfg();
    const sorted = [...this.times].sort((a, b) => a - b);
    return {
      type: "state", on: c.get("tabCompletion.enabled"), ms: c.get("tabCompletion.debounceMs"),
      model: c.get("tabCompletion.model"), onCursor: c.get("tabCompletion.onCursorMove"), speeds: this.speeds,
      last: this.times[this.times.length - 1] || null, median: sorted.length ? sorted[Math.floor(sorted.length / 2)] : null,
      key: process.platform === "darwin" ? "⌃⌥Space" : "Ctrl+Alt+Space",
      engine: c.get("tabCompletion.engine"), lastEngine: this.lastEngine,
      localModel: c.get("tabCompletion.localModel"), localModels: LOCAL_MODELS,
      local: this.local ? { running: this.local.state.running, hasModel: this.local.state.hasModel, pulling: this.local.pulling, last: this.local.last } : null,
      test: this.testResult || null,
      linux: process.platform === "linux",
    };
  }

  push() { if (this.view) this.view.webview.postMessage(this.state()); }

  resolveWebviewView(view) {
    this.view = view;
    view.webview.options = { enableScripts: true };
    const nonce = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
    view.webview.html = page(nonce, view.webview.cspSource);
    view.webview.onDidReceiveMessage(async (m) => {
      const set = (k, v) => cfg().update(k, v, vscode.ConfigurationTarget.Global);
      if (m.type === "ready") this.push();
      if (m.type === "on") await set("tabCompletion.enabled", !!m.value);
      if (m.type === "ms") await set("tabCompletion.debounceMs", Number(m.value));
      if (m.type === "model") await set("tabCompletion.model", m.value);
      if (m.type === "onCursor") await set("tabCompletion.onCursorMove", !!m.value);
      if (m.type === "engine") { await set("tabCompletion.engine", m.value); if (this.local) this.local.status(true); }
      if (m.type === "localModel") { await set("tabCompletion.localModel", m.value); if (this.local) await this.local.status(true); }
      if (m.type === "install") installOllama();
      if (m.type === "pull" && this.local) this.local.pull();
      if (m.type === "check" && this.local) { await this.local.status(true); this.push(); }
      if (m.type === "test" && this.local) {
        this.testResult = { running: true }; this.push();
        await this.local.status(true);
        this.testResult = this.local.state.hasModel ? await this.local.test() : { ok: false, error: "the model isn't available in Ollama" };
        this.push();
      }
    });
    view.onDidDispose(() => { this.view = null; });
  }
}

function page(nonce, csp) {
  return `<!doctype html><html data-fs="${fontScale()}"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<style nonce="${nonce}">
  :root { --accent: #8b6cef; --accent-hi: #a68af9; --muted: var(--vscode-descriptionForeground); --border: var(--vscode-widget-border, rgba(128,128,128,.25)); }
  body { font-family: var(--vscode-font-family); font-size: calc(13px * var(--fs, 1)); color: var(--vscode-foreground); padding: 10px 16px; }
  .row { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; margin-bottom: 14px; }
  .label { font-weight: 600; min-width: 150px; }
  .muted { color: var(--muted); font-size: .92em; }
  .switch { width: 38px; height: 20px; border-radius: 10px; background: var(--border); position: relative; cursor: pointer; border: 0; flex: none; }
  .switch::after { content: ""; position: absolute; top: 3px; left: 3px; width: 14px; height: 14px; border-radius: 50%; background: var(--vscode-foreground); transition: left .15s; }
  .switch.on { background: var(--accent); } .switch.on::after { left: 21px; background: #fff; }
  .slider { display: flex; flex-direction: column; gap: 3px; width: min(420px, 100%); }
  input[type=range] { width: 100%; accent-color: var(--accent); cursor: pointer; margin: 0; }
  .ticks { display: flex; justify-content: space-between; font-size: .85em; color: var(--muted); }
  .ticks span { cursor: pointer; } .ticks span.on { color: var(--accent-hi); font-weight: 600; }
  .seg { display: inline-flex; border: 1px solid var(--border); border-radius: 6px; overflow: hidden; }
  .seg button { background: none; border: 0; color: var(--vscode-foreground); padding: 3px 12px; cursor: pointer; font: inherit; }
  .seg button.on { background: var(--accent); color: #fff; }
  kbd { border: 1px solid var(--border); border-bottom-width: 2px; border-radius: 4px; padding: 0 5px; font-size: .9em; }
  .off .dim { opacity: .45; pointer-events: none; }
  .btn { background: var(--accent); color: #fff; border: 0; border-radius: 5px; padding: 3px 10px; cursor: pointer; font: inherit; margin-right: 6px; }
  .btn.ghost { background: none; color: var(--accent-hi); border: 1px solid var(--accent); }
  .ok { color: #6cc490; } .warn { color: #e0b45c; }
  progress { width: 160px; accent-color: var(--accent); vertical-align: middle; }
</style></head><body>
<div id="app">
  <div class="row"><span class="label">Tab completion</span><button id="on" class="switch" title="Turn on/off"></button>
    <span id="onText"></span><span class="muted">Shortcut: <kbd id="key"></kbd></span></div>
  <div class="dim">
    <div class="row"><span class="label">How fast it suggests</span>
      <div class="slider"><input id="speed" type="range" min="0" max="4" step="1"><div class="ticks" id="ticks"></div></div>
      <span id="speedText" class="muted"></span></div>
    <div class="row"><span class="label">Engine</span>
      <div class="seg" id="engine"><button data-v="auto">Auto</button><button data-v="local">Local model</button><button data-v="claude">Claude</button></div>
      <span id="engineText" class="muted"></span></div>
    <div class="row" id="localRow"><span class="label">Local model</span>
      <div class="seg" id="localModel"></div><span id="localText" class="muted"></span>
      <span id="localActions"></span></div>
    <div class="row" id="testRow"><span class="label">Speed check</span><button class="btn ghost" id="testBtn">Test local model</button><span id="testText" class="muted"></span></div>
    <div class="row"><span class="label">Claude model</span>
      <div class="seg" id="model"><button data-v="haiku">Haiku · fastest</button><button data-v="sonnet">Sonnet</button><button data-v="opus">Opus</button></div>
      <span class="muted" id="claudeText"></span></div>
    <div class="row"><span class="label">When I place the cursor</span>
      <label><input type="checkbox" id="onCursor"> also suggest (end of a line, empty line, before a closing bracket)</label></div>
    <div class="row"><span class="label">Recent suggestions</span><span id="stats" class="muted">none yet</span></div>
  </div>
</div>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  document.documentElement.style.setProperty("--fs", document.documentElement.dataset.fs || 1);
  const $ = (id) => document.getElementById(id);
  const esc = (t) => String(t || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  let S = null;
  const idx = (ms) => S.speeds.reduce((b, s, i) => Math.abs(s.ms - ms) < Math.abs(S.speeds[b].ms - ms) ? i : b, 0);
  function render() {
    document.body.classList.toggle("off", !S.on);
    $("on").classList.toggle("on", S.on); $("onText").textContent = S.on ? "On" : "Off"; $("key").textContent = S.key;
    const i = idx(S.ms);
    if (document.activeElement !== $("speed")) $("speed").value = i;
    $("ticks").replaceChildren(...S.speeds.map((s, k) => { const e = document.createElement("span"); e.textContent = s.label; e.className = k === i ? "on" : ""; e.onclick = () => send("ms", s.ms); return e; }));
    $("speedText").textContent = S.ms ? S.ms + " ms after you stop typing" : "as you type";
    for (const b of $("model").children) b.classList.toggle("on", b.dataset.v === S.model);
    for (const b of $("engine").children) b.classList.toggle("on", b.dataset.v === S.engine);
    const L = S.local || { running: false, hasModel: false };
    const useLocal = S.engine !== "claude" && L.running && L.hasModel;
    $("engineText").textContent = useLocal ? "suggestions come from the local model" : S.engine === "claude" ? "suggestions come from Claude" : "using Claude until the local model is ready";
    $("localRow").style.display = S.engine === "claude" ? "none" : "";
    $("localModel").replaceChildren(...S.localModels.map((m) => { const b = document.createElement("button"); b.textContent = m.label; b.title = m.id + " (" + m.size + ")"; b.className = m.id === S.localModel ? "on" : ""; b.onclick = () => send("localModel", m.id); return b; }));
    const cur = S.localModels.find((m) => m.id === S.localModel) || { size: "" };
    const acts = $("localActions"); acts.replaceChildren();
    const button = (text, type, ghost) => { const b = document.createElement("button"); b.className = "btn" + (ghost ? " ghost" : ""); b.textContent = text; b.onclick = () => send(type); acts.append(b); };
    if (L.pulling) {
      $("localText").textContent = "downloading " + L.pulling.model + "… " + (L.pulling.percent || 0) + "%";
      const p = document.createElement("progress"); p.max = 100; p.value = L.pulling.percent || 0; acts.append(p);
    } else if (!L.running) {
      $("localText").innerHTML = '<span class="warn">Ollama isn’t installed or running.</span>';
      button(S.linux ? "Install Ollama" : "Get Ollama", "install"); button("Check again", "check", true);
    } else if (!L.hasModel) {
      $("localText").innerHTML = '<span class="warn">Model not downloaded yet.</span>';
      button("Download (" + cur.size + ")", "pull"); button("Check again", "check", true);
    } else {
      const last = L.last;
      $("localText").innerHTML = '<span class="ok">● ready</span>' + (last && !last.ok ? ' <span class="warn">— last try: ' + esc(last.note) + '</span>' : last ? ' — last answer ' + last.ms + ' ms' : '');
    }
    $("testRow").style.display = S.engine !== "claude" && L.running && L.hasModel ? "" : "none";
    const T = S.test;
    $("testText").textContent = !T ? "" : T.running ? "testing…" : T.error ? "Test failed: " + T.error
      : T.ok ? "Test: answered in " + T.ms + " ms → " + JSON.stringify((T.output || "").trim().slice(0, 60))
      : (T.output == null ? "no answer after " + (T.ms / 1000).toFixed(1) + " s" : "empty answer (" + T.ms + " ms)") +
        (T.ms > 1500 ? " — this computer runs the model slowly: try 0.5B · fastest (Auto still uses Claude meanwhile)" : " — see View → Output → Kural");
    $("claudeText").textContent = S.engine === "claude" ? "" : "used when the local model isn't available";
    $("onCursor").checked = !!S.onCursor;
    $("stats").textContent = S.last ? "last " + S.last + " ms · typical " + S.median + " ms" + (S.lastEngine ? " (" + (S.lastEngine === "local" ? "local model" : "Claude") + ")" : "") : "none yet";
  }
  const send = (type, value) => vscode.postMessage({ type, value });
  $("on").onclick = () => send("on", !S.on);
  $("speed").oninput = () => { const s = S.speeds[$("speed").value]; $("speedText").textContent = s.ms ? s.ms + " ms after you stop typing" : "as you type"; };
  $("speed").onchange = () => send("ms", S.speeds[$("speed").value].ms);
  for (const b of $("model").children) b.onclick = () => send("model", b.dataset.v);
  for (const b of $("engine").children) b.onclick = () => send("engine", b.dataset.v);
  $("testBtn").onclick = () => send("test");
  $("onCursor").onchange = () => send("onCursor", $("onCursor").checked);
  window.addEventListener("message", (e) => { if (e.data.type === "state") { S = e.data; render(); } });
  send("ready");
</script></body></html>`;
}

module.exports = { TabPanel, _page: page };

// The Tab Completion panel at the bottom of the window: on/off, how fast it suggests (a real slider), which engine
// writes the suggestions and with which model, and how fast the last one came. Opened by clicking "Tab Completion"
// in the status bar. (A status bar hover can't hold a real slider; this panel can.)
// Always on, not shown as options: suggesting when you place the cursor, and learning from your work (lib/tab/activity.js).

const vscode = require("vscode");
const { fontScale } = require("../ui");
const { isSetUp } = require("../ai/claude");
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
      model: c.get("tabCompletion.model"), speeds: this.speeds,
      last: this.times[this.times.length - 1] || null, median: sorted.length ? sorted[Math.floor(sorted.length / 2)] : null,
      key: process.platform === "darwin" ? "⌃⌥Space" : "Ctrl+Alt+Space",
      engine: c.get("tabCompletion.engine"), lastEngine: this.lastEngine, claudeReady: isSetUp(),
      localModel: c.get("tabCompletion.localModel"), localModels: LOCAL_MODELS,
      local: this.local ? { running: this.local.state.running, hasModel: this.local.state.hasModel, pulling: this.local.pulling, last: this.local.last } : null,
      linux: process.platform === "linux",
    };
  }

  push() { if (this.view) this.view.webview.postMessage(this.state()); }

  resolveWebviewView(view) {
    this.view = view;
    const media = vscode.Uri.joinPath(this.context.extensionUri, "media");
    view.webview.options = { enableScripts: true, localResourceRoots: [media] };
    const nonce = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
    view.webview.html = page(nonce, view.webview.cspSource, view.webview.asWebviewUri(vscode.Uri.joinPath(media, "codicons", "codicon.css")));
    view.webview.onDidReceiveMessage(async (m) => {
      const set = (k, v) => cfg().update(k, v, vscode.ConfigurationTarget.Global);
      if (m.type === "ready") this.push();
      if (m.type === "on") await set("tabCompletion.enabled", !!m.value);
      if (m.type === "ms") await set("tabCompletion.debounceMs", Number(m.value));
      if (m.type === "model") await set("tabCompletion.model", m.value);
      if (m.type === "engine") { await set("tabCompletion.engine", m.value); if (this.local) this.local.status(true); }
      if (m.type === "localModel") { await set("tabCompletion.localModel", m.value); if (this.local) await this.local.status(true); }
      if (m.type === "install") installOllama();
      if (m.type === "pull" && this.local) this.local.pull();
      if (m.type === "check" && this.local) { await this.local.status(true); this.push(); }
      if (m.type === "getStarted") vscode.commands.executeCommand("kural.getStarted", "claude");
    });
    view.onDidDispose(() => { this.view = null; });
  }
}

function page(nonce, csp, codicons) {
  return `<!doctype html><html data-fs="${fontScale()}"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}' ${csp}; font-src ${csp}; script-src 'nonce-${nonce}';">
<link rel="stylesheet" href="${codicons}">
<style nonce="${nonce}">
  :root { --accent: #8b6cef; --accent-hi: #a68af9; --muted: var(--vscode-descriptionForeground); --border: var(--vscode-widget-border, rgba(128,128,128,.25)); }
  body.vscode-light { --accent: #6447d6; --accent-hi: #5a3cc8; }   /* light themes: readable on white */
  body { font-family: var(--vscode-font-family); font-size: calc(13px * var(--fs, 1)); color: var(--vscode-foreground); padding: 10px 16px; }
  .row { display: flex; align-items: center; gap: 12px; margin: 8px 0; flex-wrap: wrap; }
  .label { width: 150px; color: var(--muted); flex-shrink: 0; }
  .muted { color: var(--muted); }
  .switch { width: 34px; height: 18px; border-radius: 9px; border: 0; background: var(--border); position: relative; cursor: pointer; padding: 0; }
  .switch::after { content: ""; position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%; background: #fff; transition: left .15s; }
  .switch.on { background: var(--accent); } .switch.on::after { left: 18px; }
  .slider { width: 260px; }
  input[type=range] { width: 100%; accent-color: var(--accent); cursor: pointer; margin: 0; }
  .ticks { display: flex; justify-content: space-between; font-size: .85em; color: var(--muted); }
  .ticks span { cursor: pointer; } .ticks span.on { color: var(--accent-hi); font-weight: 600; }
  .seg { display: inline-flex; border: 1px solid var(--border); border-radius: 6px; overflow: hidden; }
  .seg button { background: none; border: 0; color: var(--vscode-foreground); padding: 3px 12px; cursor: pointer; font: inherit; }
  .seg button.on { background: var(--accent); color: #fff; }
  .seg button[disabled] { opacity: .45; cursor: default; }
  kbd { border: 1px solid var(--border); border-bottom-width: 2px; border-radius: 4px; padding: 0 5px; font-size: .9em; }
  .off .dim { opacity: .45; pointer-events: none; }
  .btn { background: var(--accent); color: #fff; border: 0; border-radius: 5px; padding: 3px 10px; cursor: pointer; font: inherit; margin-right: 6px; }
  .btn.ghost { background: none; color: var(--accent-hi); border: 1px solid var(--accent); }
  .ok { color: #6cc490; } .warn { color: #e0b45c; }
  body.vscode-light .ok { color: #2c7a34; } body.vscode-light .warn { color: #8a5d00; }
  .codicon { vertical-align: -3px; }
  progress { width: 160px; accent-color: var(--accent); vertical-align: middle; }
</style></head><body>
<div id="app">
  <div class="row"><span class="label">Tab Completion</span><button id="on" class="switch" title="Turn on/off"></button>
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
    <div class="row" id="claudeRow"><span class="label">Claude model</span>
      <div class="seg" id="model"><button data-v="haiku">Haiku · fastest</button><button data-v="sonnet">Sonnet</button><button data-v="opus">Opus</button></div>
      <span class="muted" id="claudeText"></span></div>
    <div class="row"><span class="label">Last suggestion</span><span id="stats" class="muted">none yet</span></div>
  </div>
</div>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  document.documentElement.style.setProperty("--fs", document.documentElement.dataset.fs || 1);
  const $ = (id) => document.getElementById(id);
  const esc = (t) => String(t || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const ic = (name, cls) => '<i class="codicon codicon-' + name + (cls ? " " + cls : "") + '" aria-hidden="true"></i>';
  let S = null;
  const idx = (ms) => S.speeds.reduce((b, s, i) => Math.abs(s.ms - ms) < Math.abs(S.speeds[b].ms - ms) ? i : b, 0);
  function render() {
    document.body.classList.toggle("off", !S.on);
    $("on").classList.toggle("on", S.on); $("onText").textContent = S.on ? "On" : "Off"; $("key").textContent = S.key;
    const i = idx(S.ms);
    if (document.activeElement !== $("speed")) $("speed").value = i;
    $("ticks").replaceChildren(...S.speeds.map((s, k) => { const e = document.createElement("span"); e.textContent = s.label; e.className = k === i ? "on" : ""; e.onclick = () => send("ms", s.ms); return e; }));
    $("speedText").textContent = S.ms ? S.ms + " ms after you stop typing" : "as you type";
    for (const b of $("engine").children) {
      b.classList.toggle("on", b.dataset.v === S.engine);
      // (Claude as the engine needs Claude set up.)
      b.disabled = b.dataset.v === "claude" && !S.claudeReady && S.engine !== "claude";
      b.title = b.disabled ? "Set up Claude in Get started first" : "";
    }
    const L = S.local || { running: false, hasModel: false };
    const useLocal = S.engine !== "claude" && L.running && L.hasModel;
    $("engineText").textContent = S.engine === "local" ? "suggestions come from the model on this computer"
      : S.engine === "claude" ? "suggestions come from Claude"
      : useLocal ? "the local model, with Claude racing it" : S.claudeReady ? "Claude, until the local model is ready" : "the local model, once it's ready";
    // Only the model the engine uses: Local model → its model; Claude → Claude's; Auto uses both.
    $("localRow").style.display = S.engine === "claude" ? "none" : "";
    $("claudeRow").style.display = S.engine === "local" || (S.engine === "auto" && !S.claudeReady) ? "none" : "";
    for (const b of $("model").children) b.classList.toggle("on", b.dataset.v === S.model);
    $("localModel").replaceChildren(...S.localModels.map((m) => { const b = document.createElement("button"); b.textContent = m.label; b.title = m.id + " (" + m.size + ")"; b.className = m.id === S.localModel ? "on" : ""; b.onclick = () => send("localModel", m.id); return b; }));
    const cur = S.localModels.find((m) => m.id === S.localModel) || { size: "" };
    const acts = $("localActions"); acts.replaceChildren();
    const button = (text, type, ghost) => { const b = document.createElement("button"); b.className = "btn" + (ghost ? " ghost" : ""); b.textContent = text; b.onclick = () => send(type); acts.append(b); };
    if (L.pulling) {
      $("localText").textContent = "downloading " + L.pulling.model + "… " + (L.pulling.percent || 0) + "%";
      const p = document.createElement("progress"); p.max = 100; p.value = L.pulling.percent || 0; acts.append(p);
    } else if (!L.running) {
      $("localText").innerHTML = '<span class="warn">' + ic("warning") + ' Ollama isn’t installed or running.</span>';
      button(S.linux ? "Install Ollama" : "Get Ollama", "install"); button("Check again", "check", true);
    } else if (!L.hasModel) {
      $("localText").innerHTML = '<span class="warn">' + ic("warning") + ' Model not downloaded yet.</span>';
      button("Download (" + cur.size + ")", "pull"); button("Check again", "check", true);
    } else {
      const last = L.last;
      $("localText").innerHTML = '<span class="ok">' + ic("pass-filled") + ' ready</span>' + (last && !last.ok ? ' <span class="warn">— last try: ' + esc(last.note) + '</span>' : '');
    }
    $("claudeText").textContent = S.engine === "auto" ? "races the local model; the first good answer wins" : "";
    const by = S.lastEngine === "local" ? "local model" : S.lastEngine === "claude" ? "Claude" : "";
    $("stats").textContent = S.last ? S.last + " ms" + (by ? " (" + by + ")" : "") + (S.median && S.median !== S.last ? " · usually " + S.median + " ms" : "") : "none yet";
  }
  const send = (type, value) => vscode.postMessage({ type, value });
  $("on").onclick = () => send("on", !S.on);
  $("speed").oninput = () => { const s = S.speeds[$("speed").value]; $("speedText").textContent = s.ms ? s.ms + " ms after you stop typing" : "as you type"; };
  $("speed").onchange = () => send("ms", S.speeds[$("speed").value].ms);
  for (const b of $("model").children) b.onclick = () => send("model", b.dataset.v);
  for (const b of $("engine").children) b.onclick = () => { if (!b.disabled) send("engine", b.dataset.v); };
  window.addEventListener("message", (e) => { if (e.data.type === "state") { S = e.data; render(); } });
  send("ready");
</script></body></html>`;
}

module.exports = { TabPanel, _page: page };

// The Model Router panel at the bottom of the window: what Auto prefers, which models it may pick, and what it picked
// last. Kept as small as the Tab Completion panel on purpose (Adithya found the full one unusable).
// settings.json only, not shown here: model ratings, Search & Ask ranking, chat context, cloud
// on/off, token preference, Auto Tab engine, the helper deadline.

const vscode = require("vscode");
const { fontScale } = require("../ui");
const { PROFILES } = require("./policy");

const cfg = () => vscode.workspace.getConfiguration("kural");
const validAllowed = (v) => v === null || (Array.isArray(v) && v.length <= 255 && v.every((x) => typeof x === "string" && x.length < 200));

class RouterPanel {
  constructor(context, router, refresh = async () => {}) { this.context = context; this.router = router; this.refresh = refresh; this.view = null; this.revision = 0; }

  register() {
    this.context.subscriptions.push(
      vscode.window.registerWebviewViewProvider("kural.routerPanel", this),
      vscode.commands.registerCommand("kural.modelRouter", () => vscode.commands.executeCommand("kural.routerPanel.focus")),
      this.router.onChange(() => this.push().catch(() => {})),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration("kural.modelRouter.assistant") || e.affectsConfiguration("kural.tabCompletion.ollamaUrl")) this.router.resetAssistance();
        if (e.affectsConfiguration("kural.modelRouter")) this.push().catch(() => {});
      }),
    );
    const status = vscode.window.createStatusBarItem("kural.modelRouter", vscode.StatusBarAlignment.Right, 98);
    status.name = "Model Router"; status.text = "$(git-compare) Model Router"; status.command = "kural.modelRouter";
    status.tooltip = "Choose what Auto prefers and which models it may use"; status.show(); this.context.subscriptions.push(status);
  }

  async push() {
    if (!this.view) return;
    const revision = ++this.revision, options = this.router.options();
    // Tab-only models never answer a chat, so they aren't a choice here.
    const models = (await this.router.availableModels()).filter((m) => !m.completionOnly)
      .map((m) => ({ id: m.id, label: m.label, provider: m.local ? "This computer" : m.provider, ready: m.ready }));
    const minilm = options.assistant === "minilm" ? await this.router.client.state(options).catch(() => "offline") : null;
    if (!this.view || revision !== this.revision) return;   // a newer push started while we waited
    this.view.webview.postMessage({ type: "state", profile: options.profile, profiles: PROFILES, assistant: options.assistant, minilm, download: this.download && { percent: this.download.percent }, allowed: options.allowedModels, models, last: this.router.last });
  }

  // One download at a time; the page shows its percent (or the error) next to the MiniLM switch.
  async downloadMinilm() {
    const abort = new AbortController(), job = this.download = { percent: 0, error: null, abort };
    this.push().catch(() => {});
    try {
      await this.router.client.download(this.router.options(), (p) => { job.percent = p; this.push().catch(() => {}); }, abort.signal);
      this.router.resetAssistance();
    } catch (e) { if (!abort.signal.aborted) vscode.window.showWarningMessage(`Kural: couldn't download the MiniLM model: ${e.message}`); }
    this.download = null;
    await this.push();
  }

  resolveWebviewView(view) {
    this.view = view; view.webview.options = { enableScripts: true };
    view.webview.html = page(require("crypto").randomBytes(16).toString("hex"));
    view.webview.onDidReceiveMessage(async (m) => {
      const set = (k, v) => cfg().update(`modelRouter.${k}`, v, vscode.ConfigurationTarget.Global);
      // Opening the panel re-lists local models, so a model pulled in Ollama shows up without a Refresh button.
      if (m.type === "ready") { await this.refresh(); await this.push(); }
      if (m.type === "profile" && Object.hasOwn(PROFILES, m.value)) await set("profile", m.value);
      if (m.type === "assistant" && ["native", "minilm"].includes(m.value)) await set("assistant", m.value);
      if (m.type === "download" && !this.download) await this.downloadMinilm();
      if (m.type === "stopDownload" && this.download) this.download.abort.abort();
      if (m.type === "allowed" && validAllowed(m.value)) await set("allowedModels", m.value);
    });
    view.onDidDispose(() => { this.view = null; this.revision++; });
  }
}

function page(nonce) {
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<style nonce="${nonce}">
  :root { --accent: #8b6cef; --muted: var(--vscode-descriptionForeground); --border: var(--vscode-widget-border, rgba(128,128,128,.25)); }
  body.vscode-light { --accent: #6447d6; }
  body { font-family: var(--vscode-font-family); font-size: calc(13px * ${fontScale()}); color: var(--vscode-foreground); padding: 10px 16px; }
  .row { display: flex; align-items: center; gap: 12px; margin: 8px 0; flex-wrap: wrap; }
  .label { width: 150px; color: var(--muted); flex-shrink: 0; }
  .muted { color: var(--muted); } .warn { color: #e0b45c; } body.vscode-light .warn { color: #8a5d00; }
  .seg { display: inline-flex; border: 1px solid var(--border); border-radius: 6px; overflow: hidden; }
  button { background: none; border: 0; color: var(--vscode-foreground); padding: 3px 12px; cursor: pointer; font: inherit; }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .chip { border: 1px solid var(--border); border-radius: 12px; }
  button.on { background: var(--accent); border-color: var(--accent); color: #fff; }
</style></head><body>
  <div class="row"><span class="label">Auto prefers</span>
    <div class="seg" id="profile"><button data-v="speed">Speed</button><button data-v="balanced">Balanced</button><button data-v="quality">Quality</button></div>
    <span id="profileText" class="muted"></span></div>
  <div class="row"><span class="label">Task detection</span>
    <div class="seg" id="assistant"><button data-v="native">Native</button><button data-v="minilm">MiniLM</button></div>
    <button id="download" class="chip" hidden>Download</button>
    <span id="assistantText" class="muted"></span></div>
  <div id="models"></div>
  <div class="row"><span class="label">Last choice</span><span id="last" class="muted">none yet</span></div>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; };
  const send = (type, value) => vscode.postMessage({ type, value });
  let S = null;
  function render() {
    for (const b of $("profile").children) b.classList.toggle("on", b.dataset.v === S.profile);
    $("profileText").textContent = S.profiles[S.profile];
    for (const b of $("assistant").children) b.classList.toggle("on", b.dataset.v === S.assistant);
    const dl = $("download"), warn = S.assistant === "minilm" && !S.download && S.minilm !== "ready";
    $("assistantText").className = warn ? "warn" : "muted";
    $("assistantText").textContent = S.assistant !== "minilm" ? "Fixed rules read the task: no model runs, instant."
      : S.download ? "Downloading all-minilm:22m (about 46 MB)... " + S.download.percent + "%"
      : S.minilm === "offline" ? "Ollama isn't running, so MiniLM can't work. Start Ollama or set it up in Tab Completion; Native is used meanwhile."
      : S.minilm === "missing" ? "The MiniLM model (all-minilm:22m, about 46 MB) isn't on this computer; Native is used until it's downloaded."
      : "Small local model (all-minilm:22m) reads the task; native rules pick the model.";
    dl.hidden = !(S.download || (S.assistant === "minilm" && S.minilm === "missing"));
    dl.textContent = S.download ? "Stop" : "Download";
    dl.onclick = () => send(S.download ? "stopDownload" : "download");
    // null = every model, including ones set up later.
    const on = (id) => S.allowed === null || S.allowed.includes(id);
    const ids = S.models.map((m) => m.id), ready = S.models.filter((m) => m.ready);
    const toggle = (id) => {
      const next = ids.filter((x) => x === id ? !on(x) : on(x));
      send("allowed", next.length === ids.length ? null : next);
    };
    // One row per provider; models that aren't set up are hidden (Auto can't pick them anyway).
    const rows = [...new Set(ready.map((m) => m.provider))].map((p) => {
      const row = el("div", "row"), chips = el("div", "chips");
      for (const m of ready.filter((x) => x.provider === p)) { const b = el("button", "chip" + (on(m.id) ? " on" : ""), m.label); b.onclick = () => toggle(m.id); chips.append(b); }
      row.append(el("span", "label", p), chips); return row;
    });
    const usable = ready.filter((m) => on(m.id)).length;
    const note = el("div", "row");
    note.append(el("span", "label"), !ready.length ? el("span", "warn", "No model is set up yet: open Get started.")
      : !usable ? el("span", "warn", "No model is on: Auto can't answer.") : el("span", "muted", "Auto picks only from the models that are on."));
    $("models").replaceChildren(...rows, note);
    const m = S.last && S.models.find((x) => x.id === S.last.model);
    $("last").textContent = !S.last ? "none yet" : S.last.model ? (m ? m.label : S.last.model) + " · " + S.last.reason : S.last.error;
  }
  for (const b of $("profile").children) b.onclick = () => send("profile", b.dataset.v);
  for (const b of $("assistant").children) b.onclick = () => send("assistant", b.dataset.v);
  window.addEventListener("message", (e) => { if (e.data.type === "state") { S = e.data; render(); } });
  send("ready");
</script></body></html>`;
}

module.exports = { RouterPanel, _page: page };

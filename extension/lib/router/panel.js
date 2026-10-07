// The Model Router panel at the bottom of the window: what Auto prefers (Cost, Balance, Intelligence, like Cursor's), how it
// reads the task (Native, or a helper model through Ollama, with its download), the models Auto picks from (every model of
// the AIs you set up: Claude, Google Gemini, ChatGPT (Codex); never a model on this computer), and what it picked last.
// Kept as small as the Tab Completion panel on purpose (Adithya found the full one unusable).
// settings.json only, not shown here: model ratings, Search & Ask ranking, chat context, token preference, Auto Tab
// engine, the helper deadline.

const vscode = require("vscode");
const { fontScale } = require("../ui");
const { PROFILES, traits } = require("./policy");
const { HELPERS } = require("./client");
const { ASSISTANTS } = require("./index");

const cfg = () => vscode.workspace.getConfiguration("kural");
const TIERS = { 1: "light", 2: "balanced", 3: "most capable" };

class RouterPanel {
  constructor(context, router, refresh = async () => {}) { this.context = context; this.router = router; this.refresh = refresh; this.view = null; this.revision = 0; }

  register() {
    this.context.subscriptions.push(
      vscode.window.registerWebviewViewProvider("kural.routerPanel", this),
      vscode.commands.registerCommand("kural.modelRouter", () => vscode.commands.executeCommand("kural.routerPanel.focus")),
      this.router.onChange(() => this.push().catch(() => {})),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration("kural.modelRouter.assistant") || e.affectsConfiguration("kural.tabCompletion.ollamaUrl")) {
          this.router.resetAssistance(); this.router.prepare();
        }
        if (e.affectsConfiguration("kural.modelRouter")) this.push().catch(() => {});
      }),
    );
    const status = vscode.window.createStatusBarItem("kural.modelRouter", vscode.StatusBarAlignment.Right, 98);
    status.name = "Model Router"; status.text = "$(git-compare) Model Router"; status.command = "kural.modelRouter";
    status.tooltip = "Choose what Auto prefers and how it reads your requests"; status.show(); this.context.subscriptions.push(status);
    // A helper chosen earlier gets ready in the background (its examples' centroids), so routing stays fast from the start.
    setTimeout(() => this.router.prepare(), 8000);
  }

  async push() {
    if (!this.view) return;
    const revision = ++this.revision, options = this.router.options();
    // What Auto can pick: the AIs' models (not Tab-only ones, not models on this computer), with their level.
    const models = (await this.router.availableModels()).filter((m) => !m.completionOnly && !m.local && m.ready)
      .map((m) => ({ id: m.id, label: m.label, provider: m.provider, tier: TIERS[traits(m, options.modelPreferences).quality], used: m.limitUsed }));
    const helper = HELPERS[options.assistant] || null;
    const state = helper ? await this.router.client.state(options).catch(() => "offline") : null;
    const ready = helper && state === "ready" ? !!this.router.client.loaded(new URL(options.url).origin, helper.model) : false;
    if (!this.view || revision !== this.revision) return;   // a newer push started while we waited
    this.view.webview.postMessage({ type: "state", profile: options.profile, profiles: PROFILES, assistant: options.assistant,
      helpers: HELPERS, helper: helper && { ...helper, state, ready }, download: this.download && { percent: this.download.percent },
      models, last: this.router.last });
  }

  // One download at a time; the page shows its percent (or the error) next to the helper's name.
  async downloadHelper() {
    const abort = new AbortController(), job = this.download = { percent: 0, error: null, abort };
    this.push().catch(() => {});
    try {
      await this.router.client.download(this.router.options(), (p) => { job.percent = p; this.push().catch(() => {}); }, abort.signal);
      this.router.resetAssistance();
      await this.router.prepare();
    } catch (e) { if (!abort.signal.aborted) vscode.window.showWarningMessage(`Kural: couldn't download the router's helper model: ${e.message}`); }
    this.download = null;
    await this.push();
  }

  resolveWebviewView(view) {
    this.view = view; view.webview.options = { enableScripts: true };
    view.webview.html = page(require("crypto").randomBytes(16).toString("hex"));
    view.webview.onDidReceiveMessage(async (m) => {
      const set = (k, v) => cfg().update(`modelRouter.${k}`, v, vscode.ConfigurationTarget.Global);
      // Opening the panel re-lists the models, so a newly set up AI shows up without a Refresh button.
      if (m.type === "ready") { await this.refresh(); await this.push(); }
      if (m.type === "profile" && Object.hasOwn(PROFILES, m.value)) await set("profile", m.value);
      if (m.type === "assistant" && ASSISTANTS.includes(m.value)) await set("assistant", m.value);
      if (m.type === "download" && !this.download) await this.downloadHelper();
      if (m.type === "stopDownload" && this.download) this.download.abort.abort();
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
  .chip { border: 1px solid var(--border); border-radius: 12px; padding: 2px 10px; }
  button.chip { padding: 3px 12px; }
  button.on { background: var(--accent); border-color: var(--accent); color: #fff; }
</style></head><body>
  <div class="row"><span class="label">Auto prefers</span>
    <div class="seg" id="profile"><button data-v="cost">Cost</button><button data-v="balance">Balance</button><button data-v="intelligence">Intelligence</button></div>
    <span id="profileText" class="muted"></span></div>
  <div class="row"><span class="label">Reads your request with</span>
    <div class="seg" id="assistant"><button data-v="native">Native</button><button data-v="minilm">MiniLM</button><button data-v="granite">Granite</button><button data-v="qwen3">Qwen3</button></div>
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
    const h = S.helper, dl = $("download");
    const warn = h && !S.download && (h.state !== "ready" || !h.ready);
    $("assistantText").className = warn ? "warn" : "muted";
    $("assistantText").textContent = !h ? "Kural's own word classifier: built in, instant (74 % of sizes right; a helper model gets more right)."
      : S.download ? "Downloading " + h.model + " (about " + h.size + ")... " + S.download.percent + "%"
      : h.state === "offline" ? "Ollama isn't running, so " + h.label + " can't help. Start Ollama or set it up in Tab Completion; Native is used meanwhile."
      : h.state === "missing" ? h.label + " (" + h.model + ", about " + h.size + ") isn't on this computer; Native is used until it's downloaded."
      : !h.ready ? "Getting " + h.label + " ready (a few seconds, once)..."
      : h.label + " reads your requests together with Native: " + h.note + ".";
    dl.hidden = !(S.download || (h && h.state === "missing"));
    dl.textContent = S.download ? "Stop" : "Download";
    dl.onclick = () => send(S.download ? "stopDownload" : "download");
    // The models Auto picks from, per AI, with their level. Nothing to switch: every model of the AIs you set up.
    const rows = [...new Set(S.models.map((m) => m.provider))].map((p) => {
      const row = el("div", "row"), chips = el("div", "chips");
      for (const m of S.models.filter((x) => x.provider === p)) {
        // Past half its usage limit: Auto leans away from it (Cost most), and skips it at 98 %.
        const used = typeof m.used === "number" && m.used >= 50 ? " · " + Math.round(m.used) + "% used" : "";
        chips.append(el("span", "chip", m.label + " · " + m.tier + used));
      }
      row.append(el("span", "label", p), chips); return row;
    });
    const note = el("div", "row");
    note.append(el("span", "label"), !S.models.length ? el("span", "warn", "Auto picks from Claude, Google Gemini and ChatGPT (Codex): set one up in Get started.")
      : el("span", "muted", "Auto picks from these (models on this computer only when you pick them yourself)."));
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

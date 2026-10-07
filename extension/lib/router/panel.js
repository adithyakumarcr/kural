// The Model Router panel at the bottom of the window: how Auto reads the task (Native, or a helper model through Ollama,
// with its download; the info button explains each), which AIs it picks from, and what it picked last.
// Nothing to choose about profiles or models here (Adithya): the profile (Balance, Cost, Intelligence) is picked in the
// chat's model menu, and Auto always picks from every cloud model of the AIs you set up (Claude, Google Gemini, ChatGPT
// (Codex)), never a model on this computer. Kept as small as the Tab Completion panel on purpose (Adithya found the full
// one unusable).
// settings.json only, not shown here: the profile of a new chat before you pick one, model ratings, Search & Ask ranking,
// chat context, token preference, Auto Tab engine, the helper deadline.

const vscode = require("vscode");
const { fontScale } = require("../ui");
const { eligible } = require("./policy");
const { HELPERS } = require("./client");
const { ASSISTANTS } = require("./index");

const cfg = () => vscode.workspace.getConfiguration("kural");
// The info box: what each choice is, in the panel's order. A helper's numbers are its HELPERS note (measured as in
// docs/wiki/Model-Router.md).
const ABOUT = [
  { id: "native", label: "Native", facts: "74 % of task sizes right, instant · built in, nothing to download",
    what: "Kural's own word classifier. It looks at the words and word pairs in your request: from 270 example requests it learned which words mean a quick question and which a big job." },
  { id: "minilm", label: "MiniLM",
    what: "A small embedding model: it turns your request into numbers that stand for its meaning and finds the example requests closest to it, so it also understands requests worded unlike any example. Its guess is combined with Native's." },
  { id: "granite", label: "Granite", what: "IBM's embedding model, the same idea as MiniLM: right more often, just as fast. The best balance." },
  { id: "qwen3", label: "Qwen3", what: "The embedding model of Alibaba's Qwen3 family: right most often, but a much bigger download and slower." },
].map((a) => HELPERS[a.id] ? { ...a, facts: `${HELPERS[a.id].note} · ${HELPERS[a.id].size} download`, model: HELPERS[a.id].model } : a);

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
    status.tooltip = "How Auto reads your requests and which AIs it picks from (Balance, Cost or Intelligence: the chat's model menu)";
    status.show(); this.context.subscriptions.push(status);
    // A helper chosen earlier gets ready in the background (its examples' centroids), so routing stays fast from the start.
    setTimeout(() => this.router.prepare(), 8000);
  }

  async push() {
    if (!this.view) return;
    const revision = ++this.revision, options = this.router.options(), all = await this.router.availableModels();
    // What Auto picks from, per AI: every cloud model that's set up (policy.js eligible, the list it routes with); an AI
    // that isn't set up shows with none.
    const cloud = eligible(all, {});
    const ais = [...new Set(all.filter((m) => !m.local && !m.completionOnly).map((m) => m.provider))].map((name) => {
      const models = cloud.filter((m) => m.provider === name);
      return { name, count: models.length, names: models.map((m) => m.label || m.id) };
    });
    const helper = HELPERS[options.assistant] || null;
    const state = helper ? await this.router.client.state(options).catch(() => "offline") : null;
    const ready = helper && state === "ready" ? !!this.router.client.loaded(new URL(options.url).origin, helper.model) : false;
    if (!this.view || revision !== this.revision) return;   // a newer push started while we waited
    const last = this.router.last, chosen = last && last.model && all.find((m) => m.id === last.model);
    this.view.webview.postMessage({ type: "state", assistant: options.assistant, helper: helper && { ...helper, state, ready },
      download: this.download && { percent: this.download.percent }, ais,
      last: last && { ...last, label: chosen ? chosen.label || chosen.id : last.model } });
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
    this.view = view;
    const media = vscode.Uri.joinPath(this.context.extensionUri, "media");
    view.webview.options = { enableScripts: true, localResourceRoots: [media] };
    view.webview.html = page(require("crypto").randomBytes(16).toString("hex"), view.webview.cspSource,
      view.webview.asWebviewUri(vscode.Uri.joinPath(media, "codicons", "codicon.css")));
    view.webview.onDidReceiveMessage(async (m) => {
      const set = (k, v) => cfg().update(`modelRouter.${k}`, v, vscode.ConfigurationTarget.Global);
      // Opening the panel re-lists the models, so a newly set up AI shows up without a Refresh button.
      if (m.type === "ready") { await this.refresh(); await this.push(); }
      if (m.type === "assistant" && ASSISTANTS.includes(m.value)) await set("assistant", m.value);
      if (m.type === "download" && !this.download) await this.downloadHelper();
      if (m.type === "stopDownload" && this.download) this.download.abort.abort();
    });
    view.onDidDispose(() => { this.view = null; this.revision++; });
  }
}

function page(nonce, csp = "", codicons = "") {
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const about = ABOUT.map((a) => `<b>${esc(a.label)}</b><div>${esc(a.what)}<div class="muted">${esc(a.facts)}` +
    `${a.model ? ` <span class="id">(${esc(a.model)})</span>` : ""}</div></div>`).join("\n      ");
  const ask = "What are Native, MiniLM, Granite and Qwen3?";
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}' ${csp}; font-src ${csp}; script-src 'nonce-${nonce}';">
<link rel="stylesheet" href="${codicons}">
<style nonce="${nonce}">
  :root { --accent: #8b6cef; --muted: var(--vscode-descriptionForeground); --border: var(--vscode-widget-border, rgba(128,128,128,.25)); }
  body.vscode-light { --accent: #6447d6; }
  body { font-family: var(--vscode-font-family); font-size: calc(13px * ${fontScale()}); color: var(--vscode-foreground); padding: 10px 16px; }
  [hidden] { display: none !important; }
  .row { display: flex; align-items: center; gap: 12px; margin: 8px 0; flex-wrap: wrap; }
  .label { width: 12.5em; color: var(--muted); flex-shrink: 0; }
  .text { flex: 1 1 320px; min-width: 0; }   /* beside the label, wrapping inside, unless the panel is narrow */
  .muted { color: var(--muted); } .warn { color: #e0b45c; } body.vscode-light .warn { color: #8a5d00; }
  .seg { display: inline-flex; border: 1px solid var(--border); border-radius: 6px; overflow: hidden; }
  button { background: none; border: 0; color: var(--vscode-foreground); padding: 3px 12px; cursor: pointer; font: inherit; }
  button:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 1px; }
  .chip { border: 1px solid var(--border); border-radius: 12px; padding: 3px 12px; }
  button.on { background: var(--accent); border-color: var(--accent); color: #fff; }
  button.icon { padding: 2px 4px; border-radius: 4px; color: var(--muted); line-height: 1; }
  button.icon:hover, button.icon.open { color: var(--vscode-foreground); background: var(--vscode-toolbar-hoverBackground, rgba(128,128,128,.2)); }
  .codicon { vertical-align: -3px; }
  .about { margin: 2px 0 12px calc(12.5em + 12px); max-width: 760px; border: 1px solid var(--border); border-radius: 6px; padding: 6px 12px; }
  .about p { margin: 6px 0; }
  .about .grid { display: grid; grid-template-columns: max-content 1fr; gap: 8px 14px; margin: 10px 0; }
  .about .id { white-space: nowrap; }   /* a model's name, like granite-embedding:30m, on one line */
  @media (max-width: 560px) { .about { margin-left: 0; } }
</style></head><body>
  <div class="row"><span class="label">Reads your request with</span>
    <div class="seg" id="assistant"><button data-v="native">Native</button><button data-v="minilm">MiniLM</button><button data-v="granite">Granite</button><button data-v="qwen3">Qwen3</button></div>
    <button id="info" class="icon" title="${ask}" aria-label="${ask}" aria-expanded="false" aria-controls="about"><i class="codicon codicon-info" aria-hidden="true"></i></button>
    <button id="download" class="chip" hidden>Download</button>
    <span id="assistantText" class="text muted"></span></div>
  <div id="about" class="about" hidden>
    <p>Before each message, Auto guesses how much work it is (simple, standard or complex) to pick a model that fits: a light one for a quick question, the most capable one for a big job. One of these makes the guess:</p>
    <div class="grid">
      ${about}
    </div>
    <p class="muted">MiniLM, Granite and Qwen3 run through Ollama on this computer: choose one, then Download (once). Until it's ready, Native decides. Either way, your request is read on this computer. The percentages: how often each guessed the size right in 270 example requests.</p>
  </div>
  <div class="row"><span class="label">Picks from</span><span id="ais" class="text muted"></span></div>
  <div class="row"><span class="label">Last choice</span><span id="last" class="text muted">none yet</span></div>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const $ = (id) => document.getElementById(id);
  const send = (type, value) => vscode.postMessage({ type, value });
  let S = null;
  function render() {
    for (const b of $("assistant").children) b.classList.toggle("on", b.dataset.v === S.assistant);
    const h = S.helper, dl = $("download");
    const warn = h && !S.download && (h.state !== "ready" || !h.ready);
    $("assistantText").className = warn ? "text warn" : "text muted";
    $("assistantText").textContent = !h ? "Kural's own word classifier: built in, instant (74 % of sizes right; a helper model gets more right)."
      : S.download ? "Downloading " + h.model + " (about " + h.size + ")... " + S.download.percent + "%"
      : h.state === "offline" ? "Ollama isn't running, so " + h.label + " can't help. Start Ollama or set it up in Tab Completion; Native is used meanwhile."
      : h.state === "missing" ? h.label + " (" + h.model + ", about " + h.size + ") isn't on this computer; Native is used until it's downloaded."
      : !h.ready ? "Getting " + h.label + " ready (a few seconds, once)..."
      : h.label + " reads your requests together with Native: " + h.note + ".";
    dl.hidden = !(S.download || (h && h.state === "missing"));
    dl.textContent = S.download ? "Stop" : "Download";
    dl.onclick = () => send(S.download ? "stopDownload" : "download");
    // Every cloud model of the AIs you set up, per AI: nothing to choose (hover for the models' names).
    const set = S.ais.filter((a) => a.count), missing = S.ais.filter((a) => !a.count).map((a) => a.name);
    $("ais").className = set.length ? "text muted" : "text warn";
    $("ais").textContent = !set.length ? "Nothing yet: set up Claude, Google Gemini or ChatGPT (Codex) in Get started, and Auto uses all their models."
      : "Every cloud model you have: " + set.map((a) => a.count + " from " + a.name).join(", ") + "."
        + (missing.length ? " Not set up: " + missing.join(", ") + "." : "") + " Models on this computer only when you pick them yourself.";
    $("ais").title = set.map((a) => a.name + ": " + a.names.join(", ")).join("\\n");
    $("last").textContent = !S.last ? "none yet" : S.last.model ? S.last.label + " · " + S.last.reason : S.last.error;
  }
  for (const b of $("assistant").children) b.onclick = () => send("assistant", b.dataset.v);
  $("info").onclick = () => {
    const open = $("about").hidden;
    $("about").hidden = !open; $("info").classList.toggle("open", open); $("info").setAttribute("aria-expanded", String(open));
  };
  window.addEventListener("message", (e) => { if (e.data.type === "state") { S = e.data; render(); } });
  send("ready");
</script></body></html>`;
}

module.exports = { RouterPanel, _page: page };

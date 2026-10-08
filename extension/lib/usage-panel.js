// The AI Usage panel at the bottom of the window (next to Terminal and Tab Completion): for Claude, Gemini and Codex,
// each limit in words ("Session 50% used, resets in 42 min"; Session = the 5-hour limit), with a bar and the time it resets. Clicking a usage
// item in the status bar opens it. The numbers come from lib/ai/usage.js (the programs report them; Kural reads no
// login or key itself).

const vscode = require("vscode");
const usage = require("./ai/usage");
const brain = require("./ai");
const { CLIS } = require("./ai/clis");
const { fontScale } = require("./ui");

const PROVIDERS = [
  { id: "claude", name: "Claude", page: "https://claude.ai/settings/usage" },
  { id: "agy", name: "Google Gemini" },
  { id: "codex", name: "ChatGPT (Codex)" },
  { id: "ollama", name: "Your own model" },   // (no limits: only its tokens, when it has some)
];

class UsagePanel {
  // account: lib/account.js (refreshUsage, and who's logged in for the plan); getStarted: is Claude set up.
  constructor(context, account, getStarted) {
    this.context = context;
    this.account = account;
    this.gs = getStarted;
    this.view = null;
    this.refreshing = false;
  }

  register() {
    this.context.subscriptions.push(
      vscode.window.registerWebviewViewProvider("kural.usagePanel", this),
      vscode.commands.registerCommand("kural.showUsage", () => vscode.commands.executeCommand("kural.usagePanel.focus")),
      usage.onChange(() => this.push()),
    );
  }

  state() {
    const list = PROVIDERS.map((p) => {
      const setUp = p.id === "claude" ? !!(this.gs && this.gs.passed) : p.id === "ollama" ? false : !!(brain.cli[p.id] && brain.cli[p.id].ready);
      const u = usage.current(p.id);
      const who = p.id === "claude" ? this.account && this.account.auth : this.account && this.account.cliAuth[p.id];
      const plan = (who && who.loggedIn && who.plan) ? (p.id === "claude" ? `Claude ${who.plan}` : who.plan) : "";
      return {
        id: p.id, name: p.name, setUp, plan, at: u ? u.at : null, page: p.page || (CLIS[p.id] && CLIS[p.id].usageUrl) || "",
        windows: u ? (u.windows || []).map((w) => ({ name: usage.limitName(w), used: Math.round(w.usedPercent), resetsAt: w.resetsAt || null, reset: !!w.reset })) : [],
        tokens: u && u.tokens ? { input: u.tokens.input, output: u.tokens.output } : null,
        // Tokens read (fresh input + from cache + written to cache) and written (output): today, 7 days, 30 days.
        usage: [1, 7, 30].map((d) => usage.tokenTotals(p.id, d)),
      };
    }).filter((p) => p.setUp || p.windows.length || p.tokens || p.usage[2].read || p.usage[2].written);
    return { type: "state", list, refreshing: this.refreshing };
  }

  push() { if (this.view) this.view.webview.postMessage(this.state()); }

  async refresh() {
    if (this.refreshing) return;
    this.refreshing = true; this.push();
    try { await this.account.refreshUsage(true); } finally { this.refreshing = false; this.push(); }
  }

  resolveWebviewView(view) {
    this.view = view;
    const media = vscode.Uri.joinPath(this.context.extensionUri, "media");
    view.webview.options = { enableScripts: true, localResourceRoots: [media] };
    const nonce = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
    view.webview.html = page(nonce, view.webview.cspSource, view.webview.asWebviewUri(vscode.Uri.joinPath(media, "codicons", "codicon.css")));
    view.webview.onDidReceiveMessage((m) => {
      if (m.type === "ready") this.push();
      if (m.type === "refresh") this.refresh();
      if (m.type === "page") { const p = this.state().list.find((x) => x.id === m.id); if (p && /^https:\/\//.test(p.page)) vscode.env.openExternal(vscode.Uri.parse(p.page)); }
      if (m.type === "accounts") vscode.commands.executeCommand("kural.account");
      if (m.type === "setUp") vscode.commands.executeCommand("kural.getStarted", m.id);
    });
    view.onDidChangeVisibility(() => { if (view.visible) this.push(); });
    view.onDidDispose(() => { this.view = null; });
  }
}

function page(nonce, csp, codicons) {
  return `<!doctype html><html data-fs="${fontScale()}"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}' ${csp}; font-src ${csp}; script-src 'nonce-${nonce}';">
<link rel="stylesheet" href="${codicons}">
<style nonce="${nonce}">
  :root { --accent: #8b6cef; --muted: var(--vscode-descriptionForeground); --border: var(--vscode-widget-border, rgba(128,128,128,.25));
    --track: rgba(128,128,128,.22); --warn: #e0b45c; --bad: #f14c4c; }
  body.vscode-light { --accent: #6447d6; --warn: #8a5d00; --bad: #c02a3a; }
  body { font-family: var(--vscode-font-family); font-size: calc(13px * var(--fs, 1)); color: var(--vscode-foreground); padding: 8px 16px 12px; }
  .top { display: flex; align-items: center; gap: 10px; margin-bottom: 6px; }
  .top .muted { flex: 1; }
  .muted { color: var(--muted); }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 10px 28px; }
  .prov h3 { font-size: 1em; margin: 6px 0 4px; display: flex; align-items: baseline; gap: 8px; }
  .prov h3 .muted { font-weight: normal; font-size: .92em; }
  .lim { margin: 6px 0 8px; }
  .lim .text { display: flex; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
  .lim .name { font-weight: 600; }
  .bar { height: 6px; border-radius: 3px; background: var(--track); overflow: hidden; margin: 4px 0 3px; }
  .bar span { display: block; height: 100%; background: var(--accent); border-radius: 3px; }
  .bar.warn span { background: var(--warn); } .bar.bad span { background: var(--bad); }
  .pct.warn { color: var(--warn); } .pct.bad { color: var(--bad); }
  .btn { background: none; border: 1px solid var(--border); color: var(--vscode-foreground); border-radius: 5px; padding: 2px 9px; cursor: pointer; font: inherit; }
  .btn:hover { border-color: var(--accent); }
  .btn[disabled] { opacity: .5; cursor: default; }
  .links { display: flex; gap: 6px; margin-top: 2px; }
  a { color: var(--vscode-textLink-foreground); cursor: pointer; text-decoration: none; } a:hover { text-decoration: underline; }
  .codicon { vertical-align: -3px; }
  .toks { border-collapse: collapse; margin: 6px 0 6px; font-size: .95em; }
  .toks th { font-weight: normal; color: var(--muted); text-align: right; padding: 0 0 2px 14px; }
  .toks td { padding: 1px 0 1px 14px; } .toks td:first-child { padding-left: 0; }
  .toks .num { text-align: right; font-variant-numeric: tabular-nums; }
  .spin { animation: spin 1s linear infinite; } @keyframes spin { to { transform: rotate(360deg); } }
</style></head><body>
<div class="top"><span class="muted" id="sum"></span>
  <button class="btn" id="refresh" title="Ask each program for its numbers now (Claude: one tiny request)"><i class="codicon codicon-refresh" id="rico"></i> Refresh</button>
  <button class="btn" id="acc" title="Who's logged in, switch account, log out"><i class="codicon codicon-account"></i> Accounts</button></div>
<div class="grid" id="list"></div>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  document.documentElement.style.setProperty("--fs", document.documentElement.dataset.fs || 1);
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, ...kids) => { const n = document.createElement(tag); if (cls) n.className = cls; for (const k of kids.flat()) if (k != null) n.append(k.nodeType ? k : document.createTextNode(String(k))); return n; };
  const icon = (name) => { const i = document.createElement("i"); i.className = "codicon codicon-" + name; i.setAttribute("aria-hidden", "true"); return i; };
  let S = null;
  // "42 min", "2 h 10 min", "3 days 4 h"
  function until(t) {
    const m = Math.max(0, Math.round((t - Date.now()) / 60000));
    if (m < 60) return m + " min";
    if (m < 1440) { const h = Math.floor(m / 60), r = m % 60; return h + " h" + (r ? " " + r + " min" : ""); }
    const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60);
    return d + " day" + (d > 1 ? "s" : "") + (h ? " " + h + " h" : "");
  }
  const at = (t) => new Date(t).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });
  function ago(t) {
    if (!t) return "";
    const s = Math.round((Date.now() - t) / 1000);
    return s < 60 ? "just now" : s < 3600 ? Math.round(s / 60) + " min ago" : s < 86400 ? Math.round(s / 3600) + " h ago" : new Date(t).toLocaleDateString();
  }
  const tok = (n) => n >= 1e9 ? (n / 1e9).toFixed(1) + "B" : n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + "M" : n >= 1e3 ? Math.round(n / 1e3) + "k" : String(n || 0);
  function render() {
    $("rico").className = "codicon codicon-refresh" + (S.refreshing ? " spin" : "");
    $("refresh").disabled = S.refreshing;
    if (!S.list.length) { $("sum").textContent = "No AI set up yet."; $("list").replaceChildren(); return; }
    $("sum").textContent = "How much of each plan's limits you've used, when each starts again, and how many tokens each AI read and wrote.";
    $("list").replaceChildren(...S.list.map((p) => {
      const box = el("div", "prov", el("h3", "", p.name, p.plan ? el("span", "muted", p.plan) : null));
      for (const w of p.windows) {
        const lvl = w.used >= 95 ? "bad" : w.used >= 80 ? "warn" : "";
        const reset = w.reset ? "started again" : w.resetsAt ? "resets in " + until(w.resetsAt) + " (" + at(w.resetsAt) + ")" : "";
        const bar = el("div", "bar " + lvl); const fill = document.createElement("span"); fill.style.width = Math.min(100, w.used) + "%"; bar.append(fill);
        box.append(el("div", "lim",
          el("div", "text", el("span", "", el("span", "name", w.name), " ", el("span", "pct " + lvl, w.used + "% used")), el("span", "muted", reset)), bar));
      }
      const [d1, d7, d30] = p.usage;
      if (d30.read || d30.written) {
        // Tokens: what the AI read (your messages, files, the conversation; most of it from the cache) and wrote.
        const row = (label, t) => el("tr", "", el("td", "muted", label), el("td", "num", tok(t.read)), el("td", "num muted", t.read ? Math.round(100 * t.cacheRead / t.read) + "%" : "–"), el("td", "num", tok(t.written)));
        box.append(el("table", "toks", el("tr", "", el("th", ""), el("th", "num", "read"), el("th", "num", "from cache"), el("th", "num", "written")),
          row("Today", d1), row("7 days", d7), row("30 days", d30)));
      } else if (!p.windows.length && p.tokens) box.append(el("div", "lim muted", "Today: " + tok(p.tokens.input) + " tokens in, " + tok(p.tokens.output) + " out"));
      if (!p.windows.length && !p.tokens && !d30.read) box.append(el("div", "lim muted", p.id === "claude" ? "No numbers yet. Claude sends them with each answer; Refresh asks now." : "No numbers yet. Refresh asks now."));
      const links = el("div", "links muted");
      if (p.at) links.append("Updated " + ago(p.at));
      if (p.page) { const a = el("a", "", "usage page"); a.onclick = () => vscode.postMessage({ type: "page", id: p.id }); if (p.at) links.append(" · "); links.append(a); }
      box.append(links);
      return box;
    }));
  }
  $("refresh").onclick = () => vscode.postMessage({ type: "refresh" });
  $("acc").onclick = () => vscode.postMessage({ type: "accounts" });
  window.addEventListener("message", (e) => { if (e.data.type === "state") { S = e.data; render(); } });
  setInterval(() => { if (S) render(); }, 30000);   // (the "resets in" times)
  vscode.postMessage({ type: "ready" });
</script></body></html>`;
}

module.exports = { UsagePanel, _page: page };

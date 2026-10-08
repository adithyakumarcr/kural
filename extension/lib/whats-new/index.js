// What's new: after Kural was updated (Check for Updates, or a new version installed by hand), the first start opens a
// "What's new in Kural" tab with the release notes of every version since the one you had. Also "Kural: What's New".
// The notes are RELEASE_NOTES.md, which rebrand.py puts beside the extension; without it (./install.sh --ext), the
// same file of that version's tag on GitHub. The decision and the page's HTML are in notes.js (no vscode).

const vscode = require("vscode");
const fs = require("fs");
const path = require("path");
const { log } = require("../ai/claude");
const { between, render, decide, REPO } = require("./notes");

const SEEN = "kural.whatsNew.seen";   // the version Kural last started as

class WhatsNew {
  constructor(context) { this.context = context; this.panel = null; }

  get version() { return this.context.extension.packageJSON.version; }

  // At startup, with lastUpdate()'s record (or nothing).
  start(update) {
    const seen = this.context.globalState.get(SEEN);
    const d = decide({ seen, current: this.version, update });
    if (seen !== this.version) this.context.globalState.update(SEEN, this.version);
    if (!d.show) return;
    log(`whats-new: updated from ${d.from || "an older version"} to ${this.version}`);
    // A moment after the window is up, so the editors it restores don't push the tab aside.
    const t = setTimeout(() => this.open(d.from, true).catch((e) => log(`whats-new: ${e.message}`)), 2500);
    this.context.subscriptions.push({ dispose: () => clearTimeout(t) });
  }

  async notes() {
    try { return fs.readFileSync(path.join(this.context.extensionPath, "RELEASE_NOTES.md"), "utf8"); }
    catch { /* not beside the extension: ask GitHub */ }
    try {
      const res = await fetch(`https://raw.githubusercontent.com/adithyakumarcr/kural/v${this.version}/RELEASE_NOTES.md`,
        { headers: { "User-Agent": "Kural" }, signal: AbortSignal.timeout(10000) });
      if (res.ok) return await res.text();
      log(`whats-new: GitHub answered ${res.status} for the notes`);
    } catch (e) { log(`whats-new: couldn't get the notes: ${e.message}`); }
    return "";
  }

  // from: the version you had (show everything after it); null = this version only.
  async open(from = null, updated = false) {
    const blocks = between(await this.notes(), from, this.version);
    const media = vscode.Uri.joinPath(this.context.extensionUri, "media");
    if (!this.panel) {
      const p = this.panel = vscode.window.createWebviewPanel("kural.whatsNew", "What's New in Kural", vscode.ViewColumn.Active,
        { enableScripts: false, localResourceRoots: [media] });
      p.iconPath = vscode.Uri.joinPath(media, "chat-icon.svg");
      p.onDidDispose(() => { this.panel = null; });
    } else this.panel.reveal();
    const w = this.panel.webview;
    const css = w.asWebviewUri(vscode.Uri.joinPath(media, "whats-new.css"));
    const codicons = w.asWebviewUri(vscode.Uri.joinPath(media, "codicons", "codicon.css"));
    const releases = `${REPO}/releases`;
    const body = blocks.length
      ? blocks.map((b) => `<section><h2>${b.version}</h2>\n${render(b.text)}</section>`).join("\n")
      : `<p class="none">The notes for this version aren't on this computer. <a href="${releases}/tag/v${this.version}">Read them on GitHub</a>.</p>`;
    w.html = `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${w.cspSource}; font-src ${w.cspSource};">
<link rel="stylesheet" href="${codicons}"><link rel="stylesheet" href="${css}"></head>
<body><main>
<header><i class="codicon codicon-sparkle"></i><div><h1>What's new in Kural</h1>
<p class="sub">${updated ? "Kural was updated to" : "You're using"} version ${this.version}.</p></div></header>
${body}
<footer><a href="${releases}">Every release on GitHub</a></footer>
</main></body></html>`;
  }
}

module.exports = { WhatsNew };

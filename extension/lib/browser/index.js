// Kural Browser: your web app (http://localhost:3000…) in a tab beside the code, with "Select element": click
// something on the page and it's added to the chat as context, the way Cursor does it. The page comes through a small
// proxy on this computer (proxy.js) that adds the picker (media/browser-picker.js) to it. Opened with "Kural: Open
// Browser", the chat's + menu ("Pick from a browser"), or a localhost link in an answer.

const vscode = require("vscode");
const fs = require("fs");
const path = require("path");
const { startProxy } = require("./proxy");
const { fontScale } = require("../ui");
const { log } = require("../log");

const LAST = "kural.browser.lastUrl";

class Browser {
  // onPicked(info): an element picked on the page (the chat adds it to the message you're writing).
  constructor(context, onPicked) {
    this.context = context;
    this.onPicked = onPicked;
    this.panel = null;
    this.proxy = null;
  }

  register() {
    this.context.subscriptions.push(
      vscode.commands.registerCommand("kural.browser.open", (url) => this.open(typeof url === "string" ? url : undefined)),
      { dispose: () => { if (this.proxy) this.proxy.close(); } },
    );
  }

  async ensureProxy() {
    if (this.proxy) return this.proxy;
    const picker = path.join(this.context.extensionPath, "media", "browser-picker.js");
    this.proxy = startProxy({ picker: () => fs.readFileSync(picker, "utf8"), log });
    await this.proxy.ready;
    log(`browser: proxy at ${this.proxy.origin}`);
    return this.proxy;
  }

  async open(url) {
    url = url || this.context.globalState.get(LAST) || "http://localhost:3000";
    await this.ensureProxy();
    if (!this.panel) this.create(); else this.panel.reveal();
    this.go(url);
  }

  create() {
    const media = vscode.Uri.joinPath(this.context.extensionUri, "media");
    const p = this.panel = vscode.window.createWebviewPanel("kural.browser", "Kural Browser", { viewColumn: vscode.ViewColumn.Beside, preserveFocus: false },
      { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [media] });
    p.iconPath = new vscode.ThemeIcon("globe");
    const nonce = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
    const uri = (f) => p.webview.asWebviewUri(vscode.Uri.joinPath(media, f));
    // (frame-src: the proxy only. The page itself runs in that frame, kept apart from this one.)
    p.webview.html = `<!doctype html><html data-fs="${fontScale()}"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${p.webview.cspSource}; font-src ${p.webview.cspSource}; script-src 'nonce-${nonce}'; frame-src ${this.proxy.origin};">
<link rel="stylesheet" href="${uri("codicons/codicon.css")}"><link rel="stylesheet" href="${uri("browser.css")}"></head>
<body><div id="app"></div><script nonce="${nonce}" src="${uri("browser.js")}"></script></body></html>`;
    p.webview.onDidReceiveMessage((m) => this.onMessage(m).catch((e) => log(`browser: ${e.stack}`)));
    p.onDidDispose(() => { this.panel = null; });
  }

  post(m) { if (this.panel) this.panel.webview.postMessage(m); }

  // Show an address: "localhost:5173" and "3000" are fine too.
  go(text) {
    let url = String(text || "").trim();
    if (/^\d{2,5}$/.test(url)) url = `http://localhost:${url}`;
    else if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) url = `http://${url}`;
    let src;
    try { src = this.proxy.open(url); } catch (e) { this.post({ type: "error", message: `Can't open ${text}: ${e.message}` }); return; }
    this.context.globalState.update(LAST, url);
    this.post({ type: "load", src, url });
  }

  async onMessage(m) {
    switch (m.type) {
      case "ready": if (this.proxy && this.proxy.target) this.post({ type: "address", url: this.context.globalState.get(LAST) || "" }); break;
      case "go": this.go(m.url); break;
      case "page": this.post({ type: "address", url: this.proxy.real(m.url), title: m.title }); if (m.title) this.panel.title = m.title.slice(0, 40); break;
      case "external": if (/^https?:\/\//.test(m.url || "")) vscode.env.openExternal(vscode.Uri.parse(this.proxy.real(m.url))); break;
      case "picked": {
        const info = { ...m.info, url: this.proxy.real(m.info.url) };
        log(`browser: picked ${info.short} on ${info.url}`);
        await this.onPicked(info);
        break;
      }
    }
  }
}

module.exports = { Browser };

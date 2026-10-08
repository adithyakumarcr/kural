// Kural's browser: web pages (your app on localhost, any site) in a tab inside Kural, with Cursor's "Design Mode": turn on
// the element picker, click something on the page, and it's added to the chat (its HTML, size, computed CSS, a picture
// of it, and a comment you can type: "make this bigger"). Opened with "Kural: Open Browser", the chat's + menu
// ("Pick from a browser"), or any web link in an answer.
//
// It is VS Code's own Integrated Browser (a real browser tab: any site, login, dev tools, the picker, screenshots,
// console logs), which is in the editor already. Its "add to chat" went to VS Code's chat panel, which Kural doesn't
// have; scripts/rebrand.py makes it call `kural.browser.attach` (below) instead, which puts it in Kural's chat.
// If that browser isn't there (an older VS Code), the little proxy browser of this file's second half takes over: the
// page comes through a proxy on this computer (proxy.js) that adds a picker of Kural's own (media/browser-picker.js).

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
      vscode.commands.registerCommand("kural.browser.pick", () => this.pick()),
      // From VS Code's own browser (patched in rebrand.py): what you picked or captured goes to Kural's chat.
      vscode.commands.registerCommand("kural.browser.attach", (items) => this.attach(items)),
      { dispose: () => { if (this.proxy) this.proxy.close(); } },
    );
  }

  // Is VS Code's Integrated Browser here (and patched to talk to Kural)?
  async builtIn() {
    if (this._builtIn === undefined) this._builtIn = (await vscode.commands.getCommands(true)).includes("workbench.action.browser.open");
    return this._builtIn;
  }

  async attach(items) {
    log(`browser: ${(items || []).length} item(s) from the browser: ${(items || []).map((x) => `${x.kind}${x.image ? "+picture" : ""}`).join(", ")}`);
    if (this.onItems) await this.onItems(items);
  }

  // "localhost:3000" and "3000" are http; other names (www.google.com) are https.
  static url(text) {
    let u = String(text || "").trim();
    if (/^\d{2,5}$/.test(u)) return `http://localhost:${u}`;
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(u)) return u;
    return /^(localhost|127\.\d+\.\d+\.\d+|\[::1\]|\d+\.\d+\.\d+\.\d+)(:\d+)?(\/|$)/i.test(u) ? `http://${u}` : `https://${u}`;
  }

  // Click-an-element mode: open the browser (asking for the address if nothing is open yet), then switch the picker on.
  async pick() {
    if (!(await this.builtIn())) { await this.open(); return; }
    const open = vscode.window.tabGroups.all.flatMap((g) => g.tabs).some((t) => /browser/i.test(t.input && t.input.viewType || "") || /browser/i.test(t.label || ""));
    if (!open) {
      const typed = await vscode.window.showInputBox({ title: "Open your app in Kural's browser", prompt: "Address of the page (3000, localhost:5173, https://…)",
        value: this.context.globalState.get(LAST) || "localhost:3000" });
      if (!typed) return;
      await this.open(typed);
      await new Promise((r) => setTimeout(r, 2500));   // (the page has to load before an element can be picked)
    }
    await vscode.commands.executeCommand("workbench.action.browser.addElementToChat");
  }

  async ensureProxy() {
    if (this.proxy) return this.proxy;
    const picker = path.join(this.context.extensionPath, "media", "browser-picker.js");
    this.proxy = startProxy({ picker: () => fs.readFileSync(picker, "utf8"), log, allowRemote: () => !!vscode.workspace.getConfiguration("kural").get("browser.allowRemoteSites") });
    await this.proxy.ready;
    log(`browser: proxy at ${this.proxy.origin}`);
    return this.proxy;
  }

  async open(url) {
    url = Browser.url(url || this.context.globalState.get(LAST) || "http://localhost:3000");
    this.context.globalState.update(LAST, url);
    if (await this.builtIn()) {
      await vscode.commands.executeCommand("workbench.action.browser.open", { url, openToSide: true });
      return;
    }
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
    this.post({ type: "load", src, url, remote: this.proxy.remote });
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

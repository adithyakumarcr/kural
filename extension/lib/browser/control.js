// The AI's hands in Kural's browser. The chat's browser tools (browser-mcp.js, through bridge.js) come here: which tab, the
// connection to it, Kural's questions to you, then page.js does it.
//
//   Tabs:    Kural's browser tabs (VS Code's Integrated Browser), called t1, t2… for the AI. VS Code's proposed "browser"
//            API (package.json enabledApiProposals) lists them, opens new ones (they have your logins) and gives a CDP
//            connection to one: VS Code's main process stands in for Chrome's browser, and the tab is its only page.
//   A chat:  works in one tab at a time: the one it opened or used last, or the one in front (`tab` picks another).
//            When its answer ends, Kural lets go of every tab it used (release): the network stop is lifted and the tab is
//            all yours again.
//   Asking:  ask(request) is the chat's decision (lib/chat approveBrowser): a site, the first time in a chat (Agent mode,
//            and reading in Ask/Plan); Submit, Pay, Delete, Discard (Agent mode); a file from outside the project to
//            upload. Nothing that publishes ever happens (guard.js, page.js), whatever the answers.

const vscode = require("vscode");
const fs = require("fs");
const path = require("path");
const { Cdp, transportOf } = require("./cdp");
const { Page, Stop } = require("./page");
const { Bridge, TOOLS } = require("./bridge");
const { Browser } = require("./index");
const { privateTmp, expand } = require("../paths");
const { log } = require("../log");

// The tools that only read (they change nothing on the page). (All of them: bridge.js TOOLS, described in browser-mcp.js.)
const READS = new Set(["tabs", "snapshot", "screenshot", "wait"]);

const siteOf = (url) => { try { const u = new URL(url); return /^https?:$/.test(u.protocol) ? u.host.replace(/^www\./, "") : ""; } catch { return ""; } };
// The page's title without the address VS Code adds to it ("Instagram (https://www.instagram.com/)").
const titleOf = (t) => { const s = String(t.title || ""), tail = ` (${t.url})`; return s.endsWith(tail) ? s.slice(0, -tail.length) : s; };

class BrowserControl {
  constructor(context) {
    this.context = context;
    this.ids = new WeakMap();     // a browser tab (the API's object) → "t3"
    this.next = 1;
    this.attached = new Map();    // tab → { cdp, page, holders: Set(chat id), queue, viewId, note }
    this.current = new Map();     // chat id → the tab it works in
    this.shots = 0;
    this.bridge = new Bridge((s, tool, args) => this.call(s.chat, tool, args, s.ask, s.cwd));
    this.onBusy = null;           // (tab, on): a chat's AI started / stopped using a tab (Design Mode steps aside meanwhile)
  }
  busy(t, on) { try { if (this.onBusy) this.onBusy(t, on); } catch { /* Design Mode's own problem */ } }

  // A chat's AI gets the browser tools: { token, server } (the MCP server for its program: bridge.js). ask: the chat's
  // approveBrowser. cwd: the project (where relative paths for upload start).
  session(chat, ask, cwd) { return this.bridge.session({ chat, ask, cwd }); }
  // Its program stopped: the token stops working, and Kural lets go of the tabs it used.
  endSession(token, chat) { if (token) this.bridge.end(token); if (chat) this.release(chat); }

  // VS Code's browser API is there (VS Code 1.140's Integrated Browser).
  available() { return typeof vscode.window.openBrowserTab === "function" && Array.isArray(vscode.window.browserTabs); }

  register() {
    this.context.subscriptions.push({ dispose: () => { for (const a of this.attached.values()) a.cdp.close(); this.attached.clear(); this.bridge.stop(); } });
    if (!this.available()) { log("browser: this editor has no browser API: the AI can't use the browser"); return; }
    this.context.subscriptions.push(vscode.window.onDidCloseBrowserTab((t) => {
      const a = this.attached.get(t);
      if (a) { a.cdp.close(); this.attached.delete(t); }
      for (const [chat, cur] of this.current) if (cur === t) this.current.delete(chat);
    }));
  }

  idOf(t) { let id = this.ids.get(t); if (!id) { id = `t${this.next++}`; this.ids.set(t, id); } return id; }
  tabs() { return this.available() ? vscode.window.browserTabs : []; }

  // The tab a call is about: `wanted` (t2), else the chat's own, else the one in front, else the newest.
  tabFor(chat, wanted) {
    const tabs = this.tabs();
    if (wanted) {
      const t = tabs.find((x) => this.ids.get(x) === String(wanted).trim());
      if (!t) throw new Stop(`There's no browser tab ${wanted}: the tabs tool lists them.`);
      return t;
    }
    const cur = this.current.get(chat);
    if (cur && tabs.includes(cur)) return cur;
    const t = vscode.window.activeBrowserTab || tabs[tabs.length - 1];
    if (!t) throw new Stop("No page is open in Kural's browser: open one with the open tool.");
    return t;
  }

  // A web address for the browser (http/https only, like links in the chat: Browser.url), or Stop.
  address(text) {
    const url = Browser.url(text);
    if (!url) throw new Stop(`Kural's browser opens web addresses only (http, https): ${String(text).slice(0, 100)}`);
    return url;
  }

  // One tool call from a chat. ask: the chat's approveBrowser. cwd: where relative file paths start (upload).
  // → { text, image?: { data, mime }, isError? }
  async call(chat, tool, args = {}, ask = async () => ({ allow: true }), cwd = process.cwd()) {
    if (!this.available()) return { text: "This editor has no browser the AI can use (it needs VS Code's Integrated Browser).", isError: true };
    if (!TOOLS.includes(tool)) return { text: `Unknown browser tool ${tool}.`, isError: true };
    try {
      if (tool === "tabs") return { text: this.tabsText(chat) };
      if (tool === "open") return await this.open(chat, args, ask);
      const t = this.tabFor(chat, args.tab);
      this.current.set(chat, t);
      // The site is where the page is now (the API's address can lag a moment after a click went to another site).
      const live = this.attached.get(t);
      const now = live && !live.cdp.closed ? (await live.page.info()).url || t.url : t.url;
      const url = tool === "navigate" && args.url ? this.address(args.url) : now;
      const site = siteOf(url) || "this page";
      const ok = await ask({ kind: "site", site, url, tool, readOnly: READS.has(tool) });
      if (!ok || !ok.allow) return { text: (ok && ok.message) || "The user chose not to let the AI use this page. Continue without it, or ask them.", isError: true };
      let files = null;
      if (tool === "upload") {
        files = (Array.isArray(args.files) ? args.files : [args.files]).filter(Boolean).map((f) => path.resolve(cwd, expand(String(f))));
        const missing = files.find((f) => !fs.existsSync(f) || !fs.statSync(f).isFile());
        if (missing) return { text: `There's no file ${missing}.`, isError: true };
        const up = await ask({ kind: "upload", site, files });
        if (!up || !up.allow) return { text: (up && up.message) || "The user chose not to upload that file.", isError: true };
      }
      const a = await this.attach(t);
      if (!a.holders.size) this.busy(t, true);
      a.holders.add(chat);
      const hooks = {
        commit: (v) => ask({ kind: "commit", site, label: v.label || v.word, word: v.word }),
        refused: (v) => ask({ kind: "refused", site: v.site || site, label: v.label || v.word }),
      };
      const r = await this.queued(a, () => this.run(a, t, tool, { ...args, ...(tool === "navigate" && args.url ? { url } : {}), ...(files ? { files } : {}) }, hooks));
      if (a.note) { r.text = `${a.note}\n\n${r.text}`; a.note = null; }
      return r;
    } catch (e) {
      if (e instanceof Stop) return { text: e.message, isError: true };
      log(`browser: ${tool} failed: ${e.message}`);
      return { text: `Kural couldn't do that in the browser: ${e.message}`, isError: true };
    }
  }

  async run(a, t, tool, args, hooks) {
    const p = a.page;
    switch (tool) {
      case "snapshot": return { text: await p.snapshot({ find: args.find }) };
      case "click": return { text: await p.click(args, hooks) };
      case "type": return { text: await p.type(args) };
      case "press": return { text: await p.press(args, hooks) };
      case "select": return { text: await p.select(args) };
      case "upload": return { text: await p.upload(args) };
      case "drag": return { text: await p.drag(args, hooks) };
      case "scroll": return { text: await p.scroll(args) };
      case "wait": return { text: await p.wait(args) };
      case "navigate": return { text: await p.navigate(args) };
      case "dialog": return { text: await p.dialog(args, hooks) };
      case "screenshot": {
        let shot;
        try { shot = await p.screenshot(args); }
        catch (e) {
          if (e instanceof Stop) throw e;
          throw new Stop(`Kural couldn't take a picture of the tab (${e.message}). If the tab is hidden behind another one, ask the user to show it.`);
        }
        const file = path.join(privateTmp("browser"), `shot-${++this.shots}.jpg`);
        try { fs.writeFileSync(file, Buffer.from(shot.data, "base64"), { mode: 0o600 }); } catch { /* the picture still goes with the answer */ }
        return { text: `A picture of ${JSON.stringify(titleOf(t) || t.url)}, ${shot.width}×${shot.height} in the page's own pixels: a point in it is what click and drag take (x, y). Saved as ${file}.`,
          image: { data: shot.data, mime: shot.mime } };
      }
    }
    throw new Stop(`Unknown browser tool ${tool}.`);
  }

  async open(chat, args, ask) {
    const url = this.address(args.url);
    const ok = await ask({ kind: "site", site: siteOf(url), url, tool: "open", readOnly: true });
    if (!ok || !ok.allow) return { text: (ok && ok.message) || "The user chose not to let the AI open that page.", isError: true };
    const t = await vscode.window.openBrowserTab(url, { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true });
    this.current.set(chat, t);
    const a = await this.attach(t, false);
    if (!a.holders.size) this.busy(t, true);
    a.holders.add(chat);
    return this.queued(a, async () => { await a.page.ready(url); return { text: `Opened ${url} in a new tab, ${this.idOf(t)}.\n\n${await a.page.snapshot()}` }; });
  }

  tabsText(chat) {
    const tabs = this.tabs();
    if (!tabs.length) return "No page is open in Kural's browser. the open tool opens one.";
    const cur = this.current.get(chat);
    return ["Kural's browser tabs:", ...tabs.map((t) => `- ${this.idOf(t)} ${JSON.stringify(titleOf(t))} · ${t.url}${t === cur ? " (you're using this one)" : t === vscode.window.activeBrowserTab ? " (in front)" : ""}`)].join("\n");
  }

  // The connection to a tab (made once, until Kural lets go of it): its page, and the network stop on it.
  async attach(t, show = true) {
    let a = this.attached.get(t);
    if (a && !a.cdp.closed) return a;
    const cdp = new Cdp(transportOf(await t.startCDPSession()));
    const id = this.idOf(t);
    try {
      const ps = await cdp.attach();
      const page = new Page(ps, { label: id, platform: process.platform });
      await page.init();
      a = { cdp, page, holders: new Set(), queue: Promise.resolve(), viewId: cdp.target && cdp.target.vscodeBrowserViewId, note: null };
      await page.guardNetwork((rule, url) => this.blocked(t, a, rule, url));
    } catch (e) { cdp.close(); throw e; }
    cdp.onClose(() => { a.page.close(); if (this.attached.get(t) === a) { this.attached.delete(t); if (a.holders.size) this.busy(t, false); } });
    this.attached.set(t, a);
    log(`browser: the AI is using ${id} (${siteOf(t.url) || t.url})`);
    if (show) this.show(t, a);
    return a;
  }

  // The tab in front (a hidden page isn't drawn: pictures fail, and its timers slow down). Its own editor tab, found by
  // its title, in its own group; if that can't be told for sure, nothing is moved.
  show(t, a) {
    if (!a.viewId || !t.title) return;
    // (A browser editor's tab has no input type of its own in the API: none, or a view type that says browser. Its label is
    // the page's title; the API's title adds the address: "Instagram (https://www.instagram.com/)".)
    const browserish = (x) => !x.input || /browser/i.test(String(x.input.viewType || ""));
    const named = (x) => x.label && (t.title === x.label || t.title.startsWith(`${x.label} (`));
    const found = vscode.window.tabGroups.all.flatMap((g) => g.tabs.filter((x) => named(x) && browserish(x)).map((x) => ({ g, x })));
    if (found.length !== 1 || found[0].x.isActive) return;
    vscode.commands.executeCommand("vscode.open", vscode.Uri.from({ scheme: "vscode-browser", path: `/${a.viewId}` }),
      { viewColumn: found[0].g.viewColumn, preserveFocus: true, preview: false }).then(undefined, (e) => log(`browser: couldn't bring ${this.idOf(t)} to the front: ${e.message}`));
  }

  // The network stop failed a request that publishes (guard.NETWORK): the AI hears it with its next result; you see why.
  blocked(t, a, rule, url) {
    log(`browser: stopped ${rule.what} on ${rule.site} (${String(url).split("?")[0]})`);
    a.note = `Kural stopped a request in this tab that would have meant ${rule.what} on ${rule.site}: the AI never publishes. Don't try again; tell the user what's ready.`;
    vscode.window.showWarningMessage(`Kural stopped ${rule.what} on ${rule.site}: its AI is working in that tab, and the AI never publishes. When its answer is done, the tab is yours again (you can publish yourself).`);
  }

  // One action at a time in a tab (two chats, or a team's agents, can use the same one).
  queued(a, fn) { const run = a.queue.then(fn, fn); a.queue = run.catch(() => {}); return run; }

  // The chat's answer ended: Kural lets go of the tabs it used (unless another chat still works in one).
  release(chat) {
    for (const [t, a] of this.attached) {
      a.holders.delete(chat);
      if (!a.holders.size) { this.attached.delete(t); a.cdp.close(); this.busy(t, false); log(`browser: let go of ${this.idOf(t)}`); }
    }
  }
  // The chat closed (or its program stopped): also forget which tab it used.
  end(chat) { this.release(chat); this.current.delete(chat); }
}

module.exports = { BrowserControl, READS, siteOf };

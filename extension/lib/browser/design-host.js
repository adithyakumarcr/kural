// Design Mode in the editor (Adithya, 28 Oct 2026: like Cursor's): the button in the browser bar beside the inspect button
// (scripts/rebrand.py add_design_mode_button), Cmd/Ctrl+Shift+D while a browser tab is in front, and "Kural: Toggle Design
// Mode". One DesignSession (design.js) per browser tab that has it on, over its own CDP connection. The context key
// kural.designMode (the button looks pressed) follows the tab in front. Notes go to the chat (chat.addDesignNotes); while
// the chat's AI is using the same tab (BrowserControl.onBusy), Design Mode steps aside.
const vscode = require("vscode");
const { Cdp, transportOf } = require("./cdp");
const { DesignSession } = require("./design");
const { log } = require("../log");

const KEY = "kural.designMode";
const BATCH = "browser.designMode.batch";   // (setting kural.browser.designMode.batch)

class DesignHost {
  constructor(context, { chat, control }) {
    this.context = context;
    this.chat = chat;
    this.control = control;
    this.sessions = new Map();   // browser tab -> { ds, cdp }
    this.busyTabs = new Set();
  }

  available() { return typeof vscode.window.openBrowserTab === "function" && Array.isArray(vscode.window.browserTabs); }

  register() {
    this.context.subscriptions.push(
      vscode.commands.registerCommand("kural.browser.designMode", () => this.toggle()),
      { dispose: () => { for (const t of [...this.sessions.keys()]) this.stop(t); } },
    );
    if (!this.available()) return;
    this.context.subscriptions.push(
      vscode.window.onDidChangeActiveBrowserTab(() => this.sync()),
      vscode.window.onDidCloseBrowserTab((t) => { this.sessions.delete(t); this.busyTabs.delete(t); this.sync(); }),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (!e.affectsConfiguration(`kural.${BATCH}`)) return;
        const on = this.batch();
        for (const { ds } of this.sessions.values()) ds.setBatch(on);
      }),
    );
    if (this.control) this.control.onBusy = (t, on) => {
      if (on) this.busyTabs.add(t); else this.busyTabs.delete(t);
      const s = this.sessions.get(t);
      if (s) s.ds.setBusy(on);
    };
    this.sync();
  }

  batch() { return !!vscode.workspace.getConfiguration("kural").get(BATCH, false); }
  sync() { const t = this.available() ? vscode.window.activeBrowserTab : null; vscode.commands.executeCommand("setContext", KEY, !!(t && this.sessions.has(t))); }

  async toggle() {
    if (!this.available()) {
      vscode.window.showWarningMessage("Design Mode needs the editor's Integrated Browser, which this version doesn't have.");
      return;
    }
    const t = vscode.window.activeBrowserTab;
    if (!t) {
      const go = await vscode.window.showInformationMessage("Design Mode works on a page in Kural's browser. Open one first.", "Open Browser");
      if (go) vscode.commands.executeCommand("kural.browser.open");
      return;
    }
    if (this.sessions.has(t)) return this.stop(t);
    return this.start(t);
  }

  async start(t) {
    let cdp;
    try {
      cdp = new Cdp(transportOf(await t.startCDPSession()));
      const page = await cdp.attach();
      const ds = new DesignSession(page, {
        log: (m) => log(m),
        onNotes: (notes, how) => this.deliver(notes, how),
        onExit: () => this.stop(t),
        onBatch: (on) => { vscode.workspace.getConfiguration("kural").update(BATCH, on, vscode.ConfigurationTarget.Global).then(undefined, () => {}); },
      });
      this.sessions.set(t, { ds, cdp });
      cdp.onClose(() => { if (this.sessions.get(t) && this.sessions.get(t).cdp === cdp) { this.sessions.delete(t); this.sync(); } });
      await ds.start({ batch: this.batch() });
      if (this.busyTabs.has(t)) await ds.setBusy(true);
      log(`design: on in ${t.url}`);
    } catch (e) {
      this.sessions.delete(t);
      if (cdp) cdp.close();
      log(`design: couldn't start: ${e.message}`);
      vscode.window.showWarningMessage(`Design Mode couldn't start on this page: ${e.message}`);
    }
    this.sync();
  }

  async stop(t) {
    const s = this.sessions.get(t);
    if (!s) return;
    this.sessions.delete(t);
    this.sync();
    await s.ds.stop().catch(() => {});
    s.cdp.close();
    log("design: off");
  }

  // Notes from the page: to the chat's AI at once, or into the chat box (Cmd/Ctrl+L, Option/Alt+click, Dictate: then
  // Kural's voice input starts in the chat box).
  async deliver(notes, { send = true, dictate = false } = {}) {
    if (!this.chat) return;
    await this.chat.addDesignNotes(notes, { send: send && !dictate });
    if (dictate) vscode.commands.executeCommand("kural.chat.voice").then(undefined, (e) => log(`design: dictate: ${e.message}`));
  }
}

module.exports = { DesignHost };

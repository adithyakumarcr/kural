// Kural's browser: web pages (your app on localhost, any site) in a tab inside Kural, with Cursor's "Design Mode": turn on
// the element picker, click something on the page, and it's added to the chat (its HTML, size, computed CSS, a picture
// of it, and a comment you can type: "make this bigger"). Opened with "Kural: Open Browser", the chat's + menu
// ("Pick from a browser"), or any web link in an answer.
//
// It is VS Code's own Integrated Browser (a real browser tab: any site, login, dev tools, the picker, screenshots,
// console logs), which is in the editor already. Its "add to chat" went to VS Code's chat panel, which Kural doesn't
// have; scripts/rebrand.py makes it call `kural.browser.attach` (below) instead, which puts it in Kural's chat.
// (Before 1.1.0-rc.2 a little proxy browser of Kural's own stood in when that browser was missing. It removed pages'
// security headers to add its picker, and the VSCodium Kural ships always has the real one, so it's gone: without the
// Integrated Browser a page opens in your own web browser.)

const vscode = require("vscode");
const { log } = require("../log");

const LAST = "kural.browser.lastUrl";

class Browser {
  constructor(context) {
    this.context = context;
  }

  register() {
    this.context.subscriptions.push(
      vscode.commands.registerCommand("kural.browser.open", (url) => this.open(typeof url === "string" ? url : undefined)),
      vscode.commands.registerCommand("kural.browser.pick", () => this.pick()),
      // From VS Code's own browser (patched in rebrand.py): what you picked or captured goes to Kural's chat.
      vscode.commands.registerCommand("kural.browser.attach", (items) => this.attach(items)),
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

  // "localhost:3000" and "3000" are http; other names (www.google.com) are https. Any other scheme (file:, vscode:,
  // command:…; a chat link can carry one) → null: the browser opens web pages only (APP-11).
  static url(text) {
    let u = String(text || "").trim();
    if (/^\d{2,5}$/.test(u)) return `http://localhost:${u}`;
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(u)) return /^https?:\/\//i.test(u) ? u : null;
    if (/^(javascript|data|vbscript|file|command|vscode[\w-]*):/i.test(u)) return null;
    return /^(localhost|127\.\d+\.\d+\.\d+|\[::1\]|\d+\.\d+\.\d+\.\d+)(:\d+)?(\/|$)/i.test(u) ? `http://${u}` : `https://${u}`;
  }

  // Click-an-element mode: open the browser (asking for the address if nothing is open yet), then switch the picker on.
  async pick() {
    if (!(await this.builtIn())) {
      vscode.window.showWarningMessage("Picking an element on a page needs the editor's Integrated Browser, which this version doesn't have. Add a screenshot to the chat instead (+ in the chat).");
      return;
    }
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

  async open(url) {
    const asked = url;
    url = Browser.url(url || this.context.globalState.get(LAST) || "http://localhost:3000");
    if (!url) {
      if (asked) { vscode.window.showWarningMessage(`Kural's browser opens only web addresses (http, https): ${String(asked).slice(0, 80)}`); return; }
      url = "http://localhost:3000";
    }
    this.context.globalState.update(LAST, url);
    if (await this.builtIn()) {
      await vscode.commands.executeCommand("workbench.action.browser.open", { url, openToSide: true });
      return;
    }
    log("browser: no Integrated Browser in this editor; opening the page in the web browser");
    await vscode.env.openExternal(vscode.Uri.parse(url));
  }
}

module.exports = { Browser };

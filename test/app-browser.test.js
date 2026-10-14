// APP-11: Kural's browser opens web addresses only; webview nonces are random bytes, not Math.random. Without the
// Integrated Browser a page opens in your web browser (the old proxy browser, APP-7, is gone).
const assert = require("assert");
const fs = require("fs"), path = require("path");
const Module = require("module");
const load = Module._load;
const warnings = [], commands = [];
let builtIn = true;
const opened = [];
const vscode = { workspace: { getConfiguration: () => ({ get: () => undefined }) }, window: { showWarningMessage: (m) => warnings.push(m) },
  commands: { getCommands: async () => builtIn ? ["workbench.action.browser.open"] : [], executeCommand: async (...a) => commands.push(a), registerCommand: () => ({}) },
  env: { openExternal: async (u) => opened.push(u.toString()) }, Uri: { joinPath: () => ({}), parse: (u) => ({ toString: () => u }) } };
Module._load = function (r, ...a) { return r === "vscode" ? vscode : load.call(this, r, ...a); };
const { Browser } = require("../extension/lib/browser");
const ext = path.join(__dirname, "..", "extension");

let failed = 0;
const check = async (name, fn) => { try { await fn(); console.log("ok  ", name); } catch (e) { failed++; console.error("FAIL", name, e.stack); } };
(async () => {
  await check("Browser.url: http(s) and bare names only", () => {
    assert.strictEqual(Browser.url("3000"), "http://localhost:3000");
    assert.strictEqual(Browser.url("localhost:5173/x"), "http://localhost:5173/x");
    assert.strictEqual(Browser.url("www.google.com"), "https://www.google.com");
    assert.strictEqual(Browser.url("HTTPS://a.example"), "HTTPS://a.example");
    for (const bad of ["file:///etc/passwd", "vscode://ext/x", "command:workbench.action.terminal.new", "javascript:alert(1)", "data:text/html,x", "ftp://a.example"])
      assert.strictEqual(Browser.url(bad), null, bad);
  });
  await check("open() refuses another scheme, says so, opens nothing", async () => {
    const state = new Map();
    const b = new Browser({ globalState: { get: (k) => state.get(k), update: async (k, v) => state.set(k, v) }, subscriptions: [] });
    await b.open("file:///etc/passwd");
    assert.strictEqual(commands.length, 0); assert.strictEqual(warnings.length, 1); assert.strictEqual(state.size, 0);
    await b.open("https://a.example");
    assert.deepStrictEqual(commands[0], ["workbench.action.browser.open", { url: "https://a.example", openToSide: true }]);
  });
  await check("webview nonces come from crypto", () => {
    const files = ["lib/settings-page.js", "lib/tab/panel.js", "lib/search/index.js", "lib/chat/index.js", "lib/usage-panel.js", "lib/getstarted.js"];
    for (const f of files) {
      const src = fs.readFileSync(path.join(ext, f), "utf8");
      const lines = src.split("\n").filter((l) => /\bnonce = /.test(l));
      assert.ok(lines.length, f);
      for (const l of lines) assert.match(l, /randomBytes\(16\)/, `${f}: ${l.trim()}`);
    }
  });
  await check("no Integrated Browser: the page opens in your web browser; picking says why it can't", async () => {
    const state = new Map();
    const b = new Browser({ globalState: { get: (k) => state.get(k), update: async (k, v) => state.set(k, v) }, subscriptions: [] });
    builtIn = false; commands.length = 0; warnings.length = 0;
    await b.open("localhost:5173");
    assert.deepStrictEqual(opened, ["http://localhost:5173"]); assert.strictEqual(commands.length, 0);
    await b.pick();
    assert.strictEqual(commands.length, 0); assert.match(warnings[0], /Integrated Browser/);
    for (const gone of ["lib/browser/proxy.js", "media/browser.js", "media/browser-picker.js"]) assert.ok(!fs.existsSync(path.join(ext, gone)), gone);
  });
  console.log(failed ? `app-browser: ${failed} FAILED` : "app-browser: ALL PASS"); process.exitCode = failed ? 1 : 0;
})();

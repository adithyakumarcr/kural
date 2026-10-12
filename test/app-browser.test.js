// APP-11 / APP-7: Kural's browser opens web addresses only; webview nonces are random bytes, not Math.random; the
// fallback proxy browser takes a pick only while you're picking, and never treats the page's messages as Kural's.
const assert = require("assert");
const fs = require("fs"), path = require("path");
const Module = require("module");
const load = Module._load;
const warnings = [], commands = [];
const vscode = { workspace: { getConfiguration: () => ({ get: () => undefined }) }, window: { showWarningMessage: (m) => warnings.push(m) },
  commands: { getCommands: async () => ["workbench.action.browser.open"], executeCommand: async (...a) => commands.push(a), registerCommand: () => ({}) },
  Uri: { joinPath: () => ({}) } };
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
    const files = ["lib/settings-page.js", "lib/tab/panel.js", "lib/browser/index.js", "lib/search/index.js", "lib/chat/index.js", "lib/usage-panel.js", "lib/getstarted.js"];
    for (const f of files) {
      const src = fs.readFileSync(path.join(ext, f), "utf8");
      const lines = src.split("\n").filter((l) => /\bnonce = /.test(l));
      assert.ok(lines.length, f);
      for (const l of lines) assert.match(l, /randomBytes\(16\)/, `${f}: ${l.trim()}`);
    }
  });
  await check("proxy browser page: picks only while picking; page messages never act as Kural's", () => {
    const src = fs.readFileSync(path.join(ext, "media", "browser.js"), "utf8");
    assert.match(src, /if \(e\.source === frame\.contentWindow\) \{\s*if \(!d\.kural\) return;/);
    assert.match(src, /d\.type === "picked" && picking/);
  });
  console.log(failed ? `app-browser: ${failed} FAILED` : "app-browser: ALL PASS"); process.exitCode = failed ? 1 : 0;
})();

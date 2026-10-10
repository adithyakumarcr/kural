// The build patch that routes VS Code's Integrated Browser ("Add Element to Chat", screenshots, console logs) to Kural's
// chat (scripts/rebrand.py route_browser_to_kural). Run on a real VS Code workbench file when one is around (an installed
// or built Kural, or $KURAL_WORKBENCH); skipped otherwise. Checks: the patch applies once and only once, the result is
// valid JavaScript, the browser's buttons no longer need VS Code's chat, and the stand-in it installs hands plain data
// (pictures as base64) to the command `kural.browser.attach`.
const assert = require("assert");
const fs = require("fs"), os = require("os"), path = require("path");
const vm = require("vm");
const { spawnSync } = require("child_process");

let fail = 0;
const check = async (name, fn) => { try { await fn(); console.log("ok  ", name); } catch (e) { fail++; console.log("FAIL", name, e.message); } };
const root = path.join(__dirname, "..");
const src = require("./workbench").findWorkbench();
if (!src) { console.log("(skipped: no built workbench (set KURAL_WORKBENCH))"); process.exit(0); }

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kural-rebrand-test-"));
  const out = path.join(tmp, "patched.js");
  const py = spawnSync("python3", ["-c", `
import sys
sys.path.insert(0, ${JSON.stringify(path.join(root, "scripts"))})
import rebrand
text = open(${JSON.stringify(src)}, encoding="utf-8").read()
once = rebrand.route_browser_to_kural(text)
twice = rebrand.route_browser_to_kural(once)
open(${JSON.stringify(out)}, "w", encoding="utf-8").write(once)
print("SAME_TWICE" if once == twice else "CHANGED_TWICE")
`], { encoding: "utf8" });
  await check("the patch runs without warnings", () => { assert.strictEqual(py.status, 0, py.stderr); assert.ok(!/::warning::/.test(py.stdout), py.stdout); });
  await check("patching twice changes nothing more", () => assert.ok(/SAME_TWICE/.test(py.stdout), py.stdout));
  const js = fs.readFileSync(out, "utf8");
  await check("the result is valid JavaScript", () => { const r = spawnSync(process.execPath, ["--check", out]); assert.strictEqual(r.status, 0, String(r.stderr)); });
  await check("each part is there exactly once", () => {
    assert.strictEqual(js.split("/*kural-browser*/").length - 1, 1);
    assert.strictEqual(js.split("this.__kural=").length - 1, 1);
    assert.strictEqual(js.split('kind:"element",comment:').length - 1, 1);
  });
  await check("the browser's buttons don't need VS Code's chat any more", () => {
    const i = js.indexOf("this.ID=va.AddElementToChat");
    assert.ok(i > 0);
    const action = js.slice(i, i + 700);
    assert.ok(/precondition:\w+\.and\(\w+,\w+,\w+\.negate\(\),\w+\.true\(\)\)/.test(action), action);
    assert.ok(/submenu:\w+\.BrowserChatActionsMenu,title:\w+\(\d+,"Add to Chat"\),[^}]*when:\w+\.true\(\)/.test(js));
  });
  await check("the stand-in hands plain data to kural.browser.attach (picture as base64)", async () => {
    const method = js.slice(js.indexOf("async _revealChatWidgetForAttachment("), js.indexOf("/*kural-browser*/"));
    const sent = [];
    const sandbox = { Uint8Array, btoa: (s) => Buffer.from(s, "latin1").toString("base64"), String, Ie: "commandService", out: sent };
    const w = await vm.runInNewContext(`class T { constructor() { this.__kural = { invokeFunction: (f) => f({ get: (id) => ({ executeCommand: (c, items) => out.push([id, c, items]) }) }) }; } ${method} }
      new T()._revealChatWidgetForAttachment(false);`, sandbox);
    assert.ok(w.viewModel && w.attachmentModel && typeof w.focusInput === "function" && w.inputEditor.getModel() === null);
    w.attachmentModel.addContext(
      { kind: "element", name: "button#order", fullName: "button#order.buy", value: "Attached Element Context ...", innerText: "Order more", comment: "make it bigger", imageData: new Uint8Array([1, 2, 3]), imageMimeType: "image/jpeg", ancestors: [{ not: "sent" }] },
      { kind: "image", value: { buffer: new Uint8Array([255, 216]) }, mimeType: "image/png" });
    assert.strictEqual(sent.length, 1);
    const [id, cmd, items] = sent[0];
    assert.strictEqual(id, "commandService"); assert.strictEqual(cmd, "kural.browser.attach");
    assert.deepStrictEqual(JSON.parse(JSON.stringify(items)), [
      { kind: "element", name: "button#order", fullName: "button#order.buy", value: "Attached Element Context ...", innerText: "Order more", comment: "make it bigger", mime: "image/jpeg", image: "AQID" },
      { kind: "image", value: "", mime: "image/png", image: "/9g=" }]);
  });
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(fail ? 1 : 0);
})();

// Help → Check for Updates: which release is newest, and which file each computer downloads.
const assert = require("assert");
const Module = require("module");
const load = Module._load;
Module._load = function (req, ...a) { return req === "vscode" ? {} : load.call(this, req, ...a); };   // no editor needed
const { compareVersions: cmp, newestRelease, assetFor } = require("../extension/lib/updates");

let fail = 0;
const check = (name, fn) => { try { fn(); console.log("ok  ", name); } catch (e) { fail++; console.log("FAIL", name, e.message); } };

check("versions in order: alpha < beta < rc < final < next", () => {
  const order = ["1.1.0-alpha.1", "1.1.0-alpha.2", "1.1.0-alpha.10", "1.1.0-beta.1", "1.1.0-rc.1", "1.1.0", "1.1.1-alpha.1", "1.2.0", "10.0.0"];
  for (let i = 1; i < order.length; i++) assert.ok(cmp(order[i - 1], order[i]) < 0, `${order[i - 1]} < ${order[i]}`);
  assert.strictEqual(cmp("v1.1.0-alpha.2", "1.1.0-alpha.2"), 0);
});
check("newest release, alpha/beta/rc included, drafts skipped", () => {
  const r = newestRelease([{ tag_name: "v1.1.0-alpha.1" }, { tag_name: "v1.1.0-beta.1" }, { tag_name: "v1.2.0", draft: true }, { tag_name: "nightly" }]);
  assert.strictEqual(r.version, "1.1.0-beta.1");
  assert.strictEqual(newestRelease([]), null);
});
const assets = ["kural_1.1.0-alpha.2+1.135.06055_amd64.deb", "Kural-1.1.0-alpha.2-macos-arm64.dmg", "Kural-1.1.0-alpha.2-macos-arm64.zip",
  "Kural-1.1.0-alpha.2-windows-x64-setup.exe", "Kural-1.1.0-alpha.2-windows-x64.zip"].map((name) => ({ name }));
check("the right file for each computer", () => {
  assert.strictEqual(assetFor(assets, "linux", "x64").name, assets[0].name);
  assert.strictEqual(assetFor(assets, "darwin", "arm64").name, assets[2].name);      // the .zip: it unpacks without mounting
  assert.strictEqual(assetFor(assets, "win32", "x64").name, assets[3].name);
  assert.strictEqual(assetFor(assets, "darwin", "x64"), null);                        // Intel Macs: no build
});
console.log(fail ? `updates: ${fail} FAILED` : "updates: ALL PASS");
process.exit(fail ? 1 : 0);

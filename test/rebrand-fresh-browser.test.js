// Kural's browser keeps nothing between starts: scripts/rebrand.py fresh_browser makes the workbench's
// _resolveStorageScope() always say "ephemeral" (every tab, the AI's too), package.json sets the setting the same way, and
// lib/browser/fresh.js deletes what older versions saved.
//   1. on a stand-in with the same shape (runs everywhere), 2. on a real workbench file when one is around.
const assert = require("assert");
const fs = require("fs"), os = require("os"), path = require("path");
const vm = require("vm");
const { spawnSync } = require("child_process");

let fail = 0;
const check = async (name, fn) => { try { await fn(); console.log("ok  ", name); } catch (e) { fail++; console.log("FAIL", name, e.message); } };
const root = path.join(__dirname, "..");
const py = (code, input) => spawnSync("python3", ["-c", `import sys\nsys.path.insert(0, ${JSON.stringify(path.join(root, "scripts"))})\nimport rebrand\n${code}`], { input, encoding: "utf8", maxBuffer: 1 << 28 });
const patch = (text) => py("import sys\nsys.stdout.write(rebrand.fresh_browser(sys.stdin.read()))", text);

const STAND_IN = 'class Svc{constructor(c,t,w){this.configurationService=c;this.workspaceTrustManagementService=t;this.workspaceContextService=w}' +
  'async _resolveStorageScope(){let e=this.configurationService.getValue("workbench.browser.dataStorage")??"default";return await ' +
  'this.workspaceTrustManagementService.workspaceTrustInitialized,this.workspaceContextService.getWorkbenchState()!==1&&' +
  '!this.workspaceTrustManagementService.isWorkspaceTrusted()?e="ephemeral":e==="default"&&(e="global"),e}}';
const scope = async (code, value) => {
  const sandbox = {};
  vm.runInNewContext(`${code};S=Svc`, sandbox);
  return new sandbox.S({ getValue: () => value }, { workspaceTrustInitialized: Promise.resolve(), isWorkspaceTrusted: () => true }, { getWorkbenchState: () => 2 })._resolveStorageScope();
};

(async () => {
  const r = patch(STAND_IN);
  await check("the stand-in is patched with no warning", () => { assert.strictEqual(r.status, 0); assert.ok(r.stdout.includes("kural-fresh-browser")); assert.ok(!/warning/.test(r.stdout + r.stderr)); });
  await check("unpatched, tabs get the saved storage; patched, always the in-memory one, whatever the setting says", async () => {
    assert.strictEqual(await scope(STAND_IN, undefined), "global");
    for (const v of [undefined, "default", "global", "workspace", "ephemeral"]) assert.strictEqual(await scope(r.stdout, v), "ephemeral", String(v));
  });
  await check("applying it again changes nothing", () => assert.strictEqual(patch(r.stdout).stdout, r.stdout));
  await check("code without the pattern is left alone, with a warning", () => { const x = patch("var a=1;"); assert.ok(x.stdout.endsWith("var a=1;") && /::warning::/.test(x.stdout), x.stdout); });
  await check("patch_workbench applies it", () => assert.ok(/fresh_browser\(skip_github_probe\(/.test(fs.readFileSync(path.join(root, "scripts", "rebrand.py"), "utf8"))));
  await check("package.json makes the setting ephemeral too", () => {
    const pj = JSON.parse(fs.readFileSync(path.join(root, "extension", "package.json"), "utf8"));
    assert.strictEqual(pj.contributes.configurationDefaults["workbench.browser.dataStorage"], "ephemeral");
  });

  // What older versions saved is deleted (and only that).
  const { userDataOf, savedBrowserData, forgetSaved } = require("../extension/lib/browser/fresh");
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), "kural-ud-"));
  const gs = path.join(ud, "User", "globalStorage", "kural.kural");
  for (const d of [gs, path.join(ud, "Partitions", "vscode-browser", "Cookies"), path.join(ud, "Partitions", "other"),
    path.join(ud, "User", "workspaceStorage", "abc", "browserStorage"), path.join(ud, "User", "workspaceStorage", "def", "state")])
    fs.mkdirSync(d, { recursive: true });
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "kural-out-"));
  fs.symlinkSync(outside, path.join(ud, "User", "workspaceStorage", "def", "browserStorage"));
  await check("the user data folder is found from globalStorage (also under a VS Code profile)", () => {
    assert.strictEqual(userDataOf(gs), ud);
    assert.strictEqual(userDataOf(path.join(ud, "User", "profiles", "p1", "globalStorage", "kural.kural")), ud);
    assert.strictEqual(userDataOf("/a/b"), null);
  });
  await check("the browser's saved folders are deleted; everything else (and a link's target) stays", async () => {
    assert.strictEqual(savedBrowserData(gs).length, 2);
    const gone = await forgetSaved(gs);
    assert.strictEqual(gone.length, 2);
    assert.ok(!fs.existsSync(path.join(ud, "Partitions", "vscode-browser")));
    assert.ok(!fs.existsSync(path.join(ud, "User", "workspaceStorage", "abc", "browserStorage")));
    for (const p of [gs, path.join(ud, "Partitions", "other"), path.join(ud, "User", "workspaceStorage", "def", "state"), outside]) assert.ok(fs.existsSync(p), p);
    assert.deepStrictEqual(await forgetSaved(gs), []);
  });
  fs.rmSync(ud, { recursive: true, force: true }); fs.rmSync(outside, { recursive: true, force: true });

  const src = require("./workbench").findWorkbench();
  if (!src) console.log("(real workbench file: skipped: no built workbench (set KURAL_WORKBENCH))");
  else {
    const text = fs.readFileSync(src, "utf8");
    const real = text.includes("kural-fresh-browser") ? { stdout: text, stderr: "", status: 0 } : patch(text);
    await check("the patch matches the real workbench file once, without warnings", () => {
      assert.strictEqual(real.status, 0); assert.ok(!/::warning::/.test(real.stderr + real.stdout.slice(0, 2000)));
      assert.strictEqual(real.stdout.split("kural-fresh-browser").length - 1, 1);
      assert.ok(real.stdout.includes('async _resolveStorageScope(){/*kural-fresh-browser*/return"ephemeral";let '));
    });
    await check("...and the real file is still valid JavaScript", () => {
      const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "kural-wb-")), "wb.mjs");
      fs.writeFileSync(tmp, real.stdout);
      const c = spawnSync(process.execPath, ["--check", tmp], { encoding: "utf8" });
      fs.rmSync(path.dirname(tmp), { recursive: true, force: true });
      assert.strictEqual(c.status, 0, c.stderr.slice(0, 400));
    });
  }
  process.exit(fail ? 1 : 0);
})();

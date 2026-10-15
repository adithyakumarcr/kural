// VS Code 1.140's dictation service asked for a GitHub login at every start, which woke the GitHub login extension and made
// the Mac ask for "Kural Safe Storage" (scripts/rebrand.py skip_github_probe). The patch drops that first call only.
//   1. on a stand-in with the same shape (runs everywhere), 2. on a real workbench file when one is around.
const assert = require("assert");
const fs = require("fs"), path = require("path");
const vm = require("vm");
const { spawnSync } = require("child_process");

let fail = 0;
const check = (name, fn) => { try { fn(); console.log("ok  ", name); } catch (e) { fail++; console.log("FAIL", name, e.message); } };
const root = path.join(__dirname, "..");
const py = (code, input) => spawnSync("python3", ["-c", `import sys\nsys.path.insert(0, ${JSON.stringify(path.join(root, "scripts"))})\nimport rebrand\n${code}`], { input, encoding: "utf8", maxBuffer: 1 << 28 });
const patch = (text) => py("import sys\nsys.stdout.write(rebrand.skip_github_probe(sys.stdin.read()))", text);

const STAND_IN = 'class Svc{constructor(a){this._authenticationService=a;this._updateConfiguredContextKey(),this._refreshGitHubSession(),' +
  'this._register(this._authenticationService.onDidChangeSessions(C=>{C.providerId==="github"&&this._refreshGitHubSession()})),' +
  'this._register(this._authenticationService.onDidRegisterAuthenticationProvider(C=>{C.id==="github"&&this._refreshGitHubSession()}))}' +
  '_register(x){return x}_updateConfiguredContextKey(){}async _refreshGitHubSession(){await this._authenticationService.getSessions("github",[],{silent:!0})}}';

function run(code) {
  const calls = [], handlers = {};
  const auth = { getSessions: async (id) => { calls.push(id); return []; },
    onDidChangeSessions: (f) => { handlers.sessions = f; return {}; }, onDidRegisterAuthenticationProvider: (f) => { handlers.reg = f; return {}; } };
  const sandbox = { Svc: null };
  vm.runInNewContext(`${code};Svc_=Svc`, sandbox);
  new sandbox.Svc_(auth);
  return { calls, handlers };
}

const r = patch(STAND_IN);
check("the stand-in is patched with no warning", () => { assert.strictEqual(r.status, 0); assert.ok(r.stdout.includes("kural-no-github-probe")); assert.ok(!r.stdout.includes("this._updateConfiguredContextKey(),this._refreshGitHubSession()")); assert.ok(!/warning/.test(r.stdout + r.stderr)); });
check("unpatched, creating the service asks for a GitHub login; patched, it doesn't", () => { assert.deepStrictEqual(run(STAND_IN).calls, ["github"]); assert.deepStrictEqual(run(r.stdout).calls, []); });
check("patched, it still looks again when GitHub's provider registers or its sessions change", () => {
  const { calls, handlers } = run(r.stdout);
  handlers.reg({ id: "github" }); handlers.sessions({ providerId: "github" }); handlers.reg({ id: "other" });
  assert.deepStrictEqual(calls, ["github", "github"]);
});
check("applying it again changes nothing", () => assert.strictEqual(patch(r.stdout).stdout, r.stdout));
check("code without the pattern is left alone, with a warning", () => { const x = patch("var a=1;"); assert.ok(x.stdout.endsWith("var a=1;") && /::warning::/.test(x.stdout), x.stdout); });

const src = require("./workbench").findWorkbench();
if (!src) console.log("(real workbench file: skipped: no built workbench (set KURAL_WORKBENCH))");
else {
  const text = fs.readFileSync(src, "utf8");
  if (text.includes("kural-no-github-probe")) console.log("(real workbench file: already patched; checking it)");
  const real = text.includes("kural-no-github-probe") ? { stdout: text, stderr: "", status: 0 } : patch(text);
  check("the patch matches the real workbench file once, without warnings", () => { assert.strictEqual(real.status, 0); assert.ok(!/::warning::/.test(real.stderr + real.stdout.slice(0, 2000))); assert.strictEqual(real.stdout.split("kural-no-github-probe").length - 1, 1); });
  check("...and the real service's first call is gone while its listeners stay", () => {
    assert.ok(!real.stdout.includes("this._updateConfiguredContextKey(),this._refreshGitHubSession(),"));
    assert.ok(real.stdout.includes('C.providerId==="github"&&this._refreshGitHubSession()'));
  });
}
process.exit(fail ? 1 : 0);

// Voice input: the microphone for Kural's chat page only (scripts/rebrand.py: webview_microphone, patch_webview_pre_text,
// patch_main_permissions_text). 1. On stand-ins with the same shape (run everywhere): Kural's webview frame gets
// "microphone", another extension's doesn't; the inner frame may pass it on and the page's CSP hash is its script's new
// hash; the main process allows audio-only "media" for webviews, never video. Applying twice changes nothing.
// 2. On the real files of a built Kural, when one is around (test/workbench.js).
const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs"), path = require("path"), vm = require("vm");
const { spawnSync } = require("child_process");
const { findAppRoot } = require("./workbench");

let fail = 0;
const check = async (name, fn) => { try { await fn(); console.log("ok  ", name); } catch (e) { fail++; console.log("FAIL", name, e.message); } };
const root = path.join(__dirname, "..");
const py = (fn, input) => {
  const r = spawnSync("python3", ["-c", `import sys\nsys.stdin.reconfigure(encoding="utf-8")\nsys.stdout.reconfigure(encoding="utf-8", newline="\\n")\nsys.path.insert(0, ${JSON.stringify(path.join(root, "scripts"))})\nimport rebrand\nsys.stdout.write(rebrand.${fn}(sys.stdin.read()))`],
    { input, encoding: "utf8", maxBuffer: 1 << 28 });
  if (r.status) throw new Error(r.stderr);
  return { out: r.stdout, warn: r.stderr + r.stdout.split("\n").filter((l) => l.startsWith("::warning::")).join("\n") };
};

const OUTER = 'class Wv{constructor(e){this.extension=e.extension;this._element=this._createElement(e.options,e.contentOptions)}' +
  '_createElement(e,t){let i={attrs:{},sandbox:{add(){}},style:{},setAttribute(k,v){this.attrs[k]=v}};i.className=`webview ${e.customClasses||""}`,' +
  'i.sandbox.add("allow-scripts","allow-same-origin","allow-forms","allow-pointer-lock","allow-downloads");' +
  'let n=["cross-origin-isolated","autoplay","local-network-access"];return mu||n.push("clipboard-read","clipboard-write"),i.setAttribute("allow",n.join("; ")),i}}';
const allowOf = (code, id) => vm.runInNewContext(`${code}; new Wv({extension: ${id ? `{id: {value: ${JSON.stringify(id)}}}` : "undefined"}, options: {}}). _element.attrs.allow`, { mu: false });

const PRE = `<!DOCTYPE html><html><head>
\t<meta http-equiv="Content-Security-Policy"
\t\tcontent="default-src 'none'; script-src 'sha256-OLD=' 'self'; frame-src 'self'; style-src 'unsafe-inline';">
</head><body><script async type="module">
\t\t\t\tconst allowRules = ['cross-origin-isolated;', 'autoplay;', 'local-network-access;'];
\t\t\t\tnewFrame.setAttribute('allow', allowRules.join(' '));
</script></body></html>`;
const scriptOf = (html) => /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/.exec(html)[1];
const hashOf = (s) => `sha256-${crypto.createHash("sha256").update(s, "utf8").digest("base64")}`;

const MAIN = 'let t=(u)=>u.startsWith("vscode-webview://"),o=()=>false,a=new Set(["pointerLock","notifications"]),l=new Set(["media"]),Ja={defaultSession:{' +
  'setPermissionRequestHandler(f){this.req=f},setPermissionCheckHandler(f){this.chk=f}}};' +
  'Ja.defaultSession.setPermissionRequestHandler((y,x,_,E)=>t(E.requestingUrl)?_(a.has(x)):o(y,E.requestingUrl,E.isMainFrame)?_(l.has(x)):_(!1)),' +
  'Ja.defaultSession.setPermissionCheckHandler((y,x,_,E)=>t(E.requestingUrl)?a.has(x):o(y,E.requestingUrl,E.isMainFrame)?l.has(x):!1);';
const handlers = (code) => { const c = {}; vm.runInNewContext(`${code}; out.s = Ja.defaultSession;`, { out: c }); return c.s; };
const ask = (s, perm, details) => { let got; s.req(null, perm, (v) => { got = v; }, { requestingUrl: "vscode-webview://abc/fake.html", ...details }); return got; };

(async () => {
  await check("Kural's webview frame gets the microphone; another extension's and an unknown one's don't", () => {
    const { out } = py("webview_microphone", OUTER);
    assert.ok(allowOf(out, "kural.kural").split("; ").includes("microphone"));
    assert.ok(allowOf(out, "Kural.Kural").split("; ").includes("microphone"));
    assert.ok(!allowOf(out, "vscode.markdown-language-features").includes("microphone"));
    assert.ok(!allowOf(out, null).includes("microphone"));
    assert.strictEqual(py("webview_microphone", out).out, out, "applied twice: the same");
  });

  await check("the inner frame may pass the microphone on, and the CSP pins the script's new hash", () => {
    const { out } = py("patch_webview_pre_text", PRE);
    assert.ok(scriptOf(out).includes("'microphone;'"));
    assert.ok(out.includes(`script-src '${hashOf(scriptOf(out))}'`), "the CSP hash is the new script's");
    assert.strictEqual(py("patch_webview_pre_text", out).out, out, "applied twice: the same");
  });

  await check("the main process allows audio-only media for webviews, never video, and nothing else new", () => {
    const { out } = py("patch_main_permissions_text", MAIN);
    const s = handlers(out);
    assert.strictEqual(ask(s, "media", { mediaTypes: ["audio"] }), true);
    assert.strictEqual(ask(s, "media", { mediaTypes: ["video"] }), false);
    assert.strictEqual(ask(s, "media", { mediaTypes: ["audio", "video"] }), false);
    assert.strictEqual(ask(s, "media", { mediaTypes: [] }), false);
    assert.strictEqual(ask(s, "geolocation", { mediaTypes: ["audio"] }), false);
    assert.strictEqual(s.chk(null, "media", null, { requestingUrl: "vscode-webview://abc/", mediaType: "audio" }), true);
    assert.strictEqual(s.chk(null, "media", null, { requestingUrl: "vscode-webview://abc/", mediaType: "video" }), false);
    assert.strictEqual(py("patch_main_permissions_text", out).out, out, "applied twice: the same");
  });

  await check("code that doesn't match is left as it is, with a warning", () => {
    for (const fn of ["webview_microphone", "patch_webview_pre_text", "patch_main_permissions_text"]) {
      const r = py(fn, "nothing like it");
      assert.strictEqual(r.out.replace(/::warning::.*\n?/g, ""), "nothing like it");
      assert.ok(/::warning::/.test(r.warn), fn);
    }
  });

  const app = findAppRoot();
  if (!app) console.log("skip  the real files: no built Kural here (KURAL_WORKBENCH)");
  else {
    await check(`the real files (${app}): each patch applies once, the results parse, applied twice: the same`, () => {
      const out = path.join(app, "out");
      const wb = fs.readFileSync(path.join(out, "vs/workbench/workbench.desktop.main.js"), "utf8");
      const w1 = py("webview_microphone", wb).out;
      assert.ok(w1.includes('/*kural-mic*/this.extension?.id?.value?.toLowerCase()==="kural.kural"'));
      const pre = fs.readFileSync(path.join(out, "vs/workbench/contrib/webview/browser/pre/index.html"), "utf8");
      const p1 = py("patch_webview_pre_text", pre).out;
      assert.ok(scriptOf(p1).includes("'microphone;'") && p1.includes(hashOf(scriptOf(p1))));
      const main = fs.readFileSync(path.join(out, "mainImpl.js"), "utf8");
      const m1 = py("patch_main_permissions_text", main).out;
      assert.strictEqual((m1.match(/\/\*kural-mic\*\//g) || []).length, 2);
      assert.strictEqual(py("patch_main_permissions_text", m1).out, m1);
      const tmp = path.join(require("os").tmpdir(), `kural-mic-${process.pid}.mjs`);
      fs.writeFileSync(tmp, m1);
      const r = spawnSync(process.execPath, ["--check", tmp], { encoding: "utf8" });
      fs.unlinkSync(tmp);
      assert.strictEqual(r.status, 0, r.stderr);
    });
  }

  console.log(fail ? `rebrand-webview-mic: ${fail} FAILED` : "rebrand-webview-mic: ALL PASS");
  process.exit(fail ? 1 : 0);
})();

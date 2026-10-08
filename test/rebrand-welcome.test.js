// VSCodium's own content is gone from Kural (scripts/rebrand.py): the Welcome page's "VSCodium Announcements" (fetched from
// VSCodium's GitHub) and its "Get started with VSCodium" walkthrough, the editor's texts that say "VSCodium", and the Help
// links (Report Issue, View License) that opened VSCodium's GitHub.
//   1. rebrand.main on a tiny stand-in app folder (runs everywhere, also in CI): product.json's links, the texts.
//   2. the Welcome patch on a real VS Code workbench file when one is around (an installed or built Kural, or
//      $KURAL_WORKBENCH); skipped otherwise: it applies once, changes nothing the second time, leaves valid JavaScript.
const assert = require("assert");
const fs = require("fs"), os = require("os"), path = require("path");
const { spawnSync } = require("child_process");

let fail = 0;
const check = async (name, fn) => { try { await fn(); console.log("ok  ", name); } catch (e) { fail++; console.log("FAIL", name, e.message); } };
const root = path.join(__dirname, "..");
const py = (code) => spawnSync("python3", ["-c", `import sys, json, hashlib, base64\nsys.path.insert(0, ${JSON.stringify(path.join(root, "scripts"))})\nimport rebrand\n${code}`], { encoding: "utf8" });
const BARE = /(?<![/\w])VSCodium(?![\w/])/;

(async () => {
  // ---------- 1. a stand-in app folder ----------
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kural-rebrand-welcome-"));
  const app = path.join(tmp, "app");
  const put = (rel, text) => { const f = path.join(app, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };
  const workbench = "/* a stand-in for workbench.desktop.main.js */";
  const sha = (s) => require("crypto").createHash("sha256").update(s).digest("base64").replace(/=+$/, "");
  const messages = ["Please restart VSCodium before reinstalling {0}.", "Documentation", "VSCodium", "Quality type of VSCodium",
    "See https://github.com/VSCodium/vscodium/issues and VSCodium's rules", "Open VSCodium's settings",
    'Before you report an issue here please <a href="https://github.com/VSCodium/vscodium/wiki/Submitting-Bugs-and-Suggestions" target="_blank">review the guidance we provide</a>.',
    "Before you report an issue here please [review the guidance we provide](https://github.com/microsoft/vscode/wiki/Submitting-Bugs-and-Suggestions).",
    "The word VSCodiumX or xVSCodium isn't the name", "Ünïcode stays: 日本語"];
  put("product.json", JSON.stringify({ nameShort: "VSCodium", reportIssueUrl: "https://github.com/VSCodium/vscodium/issues/new",
    licenseUrl: "https://github.com/VSCodium/vscodium/blob/master/LICENSE", checksums: { "vs/workbench/workbench.desktop.main.js": sha(workbench) } }));
  put("package.json", JSON.stringify({ name: "vscodium" }));
  put("extensions/git/package.json", JSON.stringify({ contributes: { keybindings: [] } }));
  put("out/vs/workbench/workbench.desktop.main.js", workbench);
  put("out/nls.messages.json", JSON.stringify(messages));
  fs.mkdirSync(path.join(app, "out", "media"), { recursive: true });
  fs.mkdirSync(path.join(app, "resources", "linux"), { recursive: true });
  const run = py(`rebrand.main(${JSON.stringify(app)}, "linux")`);
  // (The stand-in has none of VS Code's code the workbench patches look for, so those warn: expected. The messages and
  // product.json parts must not.)
  const mine = (out) => out.split("\n").filter((l) => /::warning::.*(nls\.messages|texts keep saying)/.test(l));
  await check("rebrand.main runs on the stand-in; the messages and product.json parts have nothing to warn about", () => {
    assert.strictEqual(run.status, 0, run.stderr); assert.deepStrictEqual(mine(run.stdout), []); assert.ok(/rebranded /.test(run.stdout), run.stdout);
  });
  const product = JSON.parse(fs.readFileSync(path.join(app, "product.json"), "utf8"));
  await check("Help → Report Issue and View License go to Kural's repository, not VSCodium's", () => {
    assert.strictEqual(product.reportIssueUrl, "https://github.com/adithyakumarcr/kural/issues/new");
    assert.strictEqual(product.licenseUrl, "https://github.com/adithyakumarcr/kural/blob/main/LICENSE");
  });
  const out = JSON.parse(fs.readFileSync(path.join(app, "out", "nls.messages.json"), "utf8"));
  await check("the editor's texts say Kural, never inside a web address, the same number of them in the same order", () => {
    assert.strictEqual(out.length, messages.length);
    assert.strictEqual(out[0], "Please restart Kural before reinstalling {0}.");
    assert.strictEqual(out[2], "Kural"); assert.strictEqual(out[3], "Quality type of Kural");
    assert.strictEqual(out[4], "See https://github.com/VSCodium/vscodium/issues and Kural's rules");   // (the link keeps working)
    assert.strictEqual(out[5], "Open Kural's settings");
    assert.strictEqual(out[8], messages[8]);                  // (part of another word: not the name)
    assert.strictEqual(out[9], messages[9]);
    assert.strictEqual(out[1], "Documentation");
    for (const m of out) assert.ok(!BARE.test(m), m);
  });
  await check("the issue reporter's guidance links go to Kural's contributing guide (both of them)", () => {
    assert.ok(out[6].includes('href="https://github.com/adithyakumarcr/kural/blob/main/CONTRIBUTING.md"'), out[6]);
    assert.ok(out[7].includes("](https://github.com/adithyakumarcr/kural/blob/main/CONTRIBUTING.md)"), out[7]);
  });
  await check("running it again changes nothing (the messages file, product.json)", () => {
    const before = [fs.readFileSync(path.join(app, "out", "nls.messages.json"), "utf8"), fs.readFileSync(path.join(app, "product.json"), "utf8")];
    const again = py(`rebrand.main(${JSON.stringify(app)}, "linux")`);
    assert.strictEqual(again.status, 0, again.stderr); assert.deepStrictEqual(mine(again.stdout), []);
    assert.deepStrictEqual([fs.readFileSync(path.join(app, "out", "nls.messages.json"), "utf8"), fs.readFileSync(path.join(app, "product.json"), "utf8")], before);
  });
  await check("the stand-in's checksum was left alone (nothing in the workbench file to patch)", () => {
    assert.strictEqual(product.checksums["vs/workbench/workbench.desktop.main.js"], sha(workbench));
  });
  await check("Kural's own setting turns the announcements fetch off too", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "extension", "package.json"), "utf8"));
    assert.strictEqual(pkg.contributes.configurationDefaults["workbench.welcomePage.extraAnnouncements"], false);
  });

  // ---------- 2. a real workbench file ----------
  const rel = path.join("Contents", "Resources", "app", "out", "vs", "workbench", "workbench.desktop.main.js");
  const candidates = [process.env.KURAL_WORKBENCH, path.join("/Applications/Kural.app", rel), path.join(root, "kural", "build", "mac", "dmg", "Kural.app", rel),
    path.join(root, "build", "mac", "Kural.app", rel)].filter(Boolean);
  const src = candidates.find((f) => fs.existsSync(f));
  if (!src) { console.log("(real workbench file: skipped, none here)"); process.exit(fail ? 1 : 0); }
  const patched = path.join(tmp, "patched.js");
  const r = py(`
text = open(${JSON.stringify(src)}, encoding="utf-8").read()
once = rebrand.drop_vscodium_welcome(text)
twice = rebrand.drop_vscodium_welcome(once)
open(${JSON.stringify(patched)}, "w", encoding="utf-8").write(once)
print("SAME_TWICE" if once == twice else "CHANGED_TWICE")
`);
  await check("the Welcome patch runs on a real workbench file without warnings, and again changes nothing", () => {
    assert.strictEqual(r.status, 0, r.stderr); assert.ok(!/::warning::/.test(r.stdout), r.stdout); assert.ok(/SAME_TWICE/.test(r.stdout), r.stdout);
  });
  const js = fs.readFileSync(patched, "utf8");
  await check("the result is valid JavaScript", () => { const c = spawnSync(process.execPath, ["--check", patched]); assert.strictEqual(c.status, 0, String(c.stderr)); });
  await check("the announcements are never built or placed (so nothing is fetched from VSCodium's GitHub), the page keeps its walkthroughs", () => {
    assert.ok(!/await this\.buildAnnouncementList\(\)/.test(js));
    assert.ok(/classList\.remove\("noWalkthroughs"\),([\w$]+)\(([\w$]+),[\w$]+\.getDomElement\(\)\)\):\(this\.container\.classList\.add\("noWalkthroughs"\),\1\(\2\)\)/.test(js));
  });
  await check("the \"Get started with VSCodium\" walkthrough is switched off (its condition is false)", () => {
    assert.ok(/\{id:"Setup",title:[\w$]+\(\d+,null\),description:[\w$]+\(\d+,null\),isFeatured:!0,icon:[\w$]+,when:"false"/.test(js));
  });
  const nls = path.join(path.dirname(src), "..", "..", "nls.messages.json");
  if (fs.existsSync(nls)) {
    const copy = path.join(tmp, "real");
    fs.mkdirSync(path.join(copy, "out"), { recursive: true }); fs.copyFileSync(nls, path.join(copy, "out", "nls.messages.json"));
    const before = JSON.parse(fs.readFileSync(nls, "utf8"));
    const m = py(`rebrand.rebrand_messages(${JSON.stringify(copy)})`);
    const after = JSON.parse(fs.readFileSync(path.join(copy, "out", "nls.messages.json"), "utf8"));
    await check("the real messages file: none says VSCodium on its own, the others are as they were", () => {
      assert.strictEqual(m.status, 0, m.stderr); assert.ok(!/::warning::/.test(m.stdout), m.stdout);
      assert.strictEqual(after.length, before.length);
      let changed = 0;
      after.forEach((s, i) => {
        if (typeof s !== "string") return assert.strictEqual(s, before[i]);
        assert.ok(!BARE.test(s), s.slice(0, 100));
        if (s !== before[i]) { changed++; assert.ok(BARE.test(before[i]) || /Submitting-Bugs-and-Suggestions/.test(before[i]), before[i].slice(0, 100)); }
      });
      console.log(`      (${changed} messages changed)`);
    });
  }
  console.log(fail ? `rebrand-welcome: ${fail} FAILED` : "rebrand-welcome: ALL PASS");
  process.exit(fail ? 1 : 0);
})();

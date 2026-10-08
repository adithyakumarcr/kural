// "Did you know?" (extension/media/facts.js): enough facts, each short (three lines in a narrow chat), no emoji, a https link
// to a known source, and every Kural guide link pointing at a page the guide has (docs/wiki). The links themselves were
// checked by hand (curl -sIL); this runs offline.
const assert = require("assert");
const fs = require("fs"), path = require("path");
const FACTS = require("../extension/media/facts.js");

let failed = 0;
const check = (name, fn) => { try { fn(); console.log("ok  ", name); } catch (e) { failed++; console.error("FAIL", name, e.message); } };
const HOSTS = ["github.com", "developer.mozilla.org", "git-scm.com", "en.wikipedia.org", "docs.python.org", "peps.python.org", "wiki.python.org",
  "www.gnu.org", "code.visualstudio.com", "www.typescriptlang.org", "doc.rust-lang.org", "semver.org", "info.cern.ch",
  "cheatsheetseries.owasp.org", "12factor.net"];

check("60+ facts, each a short line of text with a https link to a known source", () => {
  assert.ok(FACTS.length >= 60, `${FACTS.length} facts`);
  for (const f of FACTS) {
    assert.ok(typeof f.t === "string" && f.t.length >= 20 && f.t.length <= 110, `length ${f.t.length}: ${f.t}`);
    assert.ok(!/[\n\r]/.test(f.t), f.t);
    assert.ok(!/[\p{Extended_Pictographic}]/u.test(f.t), `emoji: ${f.t}`);
    const u = new URL(f.u);
    assert.strictEqual(u.protocol, "https:", f.u);
    assert.ok(HOSTS.includes(u.host), `unknown source ${u.host}`);
  }
  assert.strictEqual(new Set(FACTS.map((f) => f.t)).size, FACTS.length, "a fact is listed twice");
});
check("links to Kural's guide point at pages it has", () => {
  const wiki = path.join(__dirname, "..", "docs", "wiki");
  let n = 0;
  for (const f of FACTS) {
    const m = /^https:\/\/github\.com\/adithyakumarcr\/kural\/(?:wiki\/([\w-]+)|blob\/main\/docs\/wiki\/([\w-]+)\.md)$/.exec(f.u);
    if (!/github\.com/.test(f.u)) continue;
    assert.ok(m, `a GitHub link that isn't the guide: ${f.u}`);
    assert.ok(fs.existsSync(path.join(wiki, `${m[1] || m[2]}.md`)), `no docs/wiki/${m[1] || m[2]}.md`);
    n++;
  }
  assert.ok(n >= 25, `${n} Kural tips`);
});
check("the chat page loads the facts before its own script", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "extension", "lib", "chat", "index.js"), "utf8");
  assert.ok(src.indexOf('uri("facts.js")') > 0 && src.indexOf('uri("facts.js")') < src.indexOf('uri("chat.js")'));
  const page = fs.readFileSync(path.join(__dirname, "..", "extension", "media", "chat.js"), "utf8");
  new Function(page);   // (parses)
  assert.ok(/window\.KURAL_FACTS/.test(page));
});

console.log(failed ? `facts: ${failed} FAILED` : "facts: ALL PASS");
process.exit(failed ? 1 : 0);

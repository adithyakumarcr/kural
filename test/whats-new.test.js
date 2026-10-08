// What's new (extension/lib/whats-new/notes.js): which release notes to show after an update, and their HTML.
const assert = require("assert");
const fs = require("fs"), path = require("path");
const { sections, between, render, decide } = require("../extension/lib/whats-new/notes");
let passed = 0, failed = 0;
const check = (name, fn) => { try { fn(); passed++; console.log("ok  ", name); } catch (e) { failed++; console.error("FAIL", name, e.stack); } };

const MD = `## Not released yet

- **Later.** Not out yet.

## What's new in 1.2.0-alpha.3

- **Three.** Line one
  continues here.
- Uses \`code\` and [a doc](docs/x.md).

## What's new in 1.2.0-alpha.2

- **Two.**

## What's new in 1.2.0-alpha.1

- **One.**

## Downloads

| a | b |
`;

check("sections: only 'What's new in' blocks, in file order", () => {
  assert.deepStrictEqual(sections(MD).map((s) => s.version), ["1.2.0-alpha.3", "1.2.0-alpha.2", "1.2.0-alpha.1"]);
  assert.ok(!sections(MD).some((s) => /Later|Downloads|\| a/.test(s.text)));
});

check("between: every version after the old one up to this one, newest first", () => {
  assert.deepStrictEqual(between(MD, "1.2.0-alpha.1", "1.2.0-alpha.3").map((s) => s.version), ["1.2.0-alpha.3", "1.2.0-alpha.2"]);
  assert.deepStrictEqual(between(MD, "1.2.0-alpha.2", "1.2.0-alpha.3").map((s) => s.version), ["1.2.0-alpha.3"]);
  assert.deepStrictEqual(between(MD, null, "1.2.0-alpha.2").map((s) => s.version), ["1.2.0-alpha.2"]);
  assert.deepStrictEqual(between("", null, "1.2.0"), []);
});

check("decide: newer than seen → show since seen; same or older → no", () => {
  assert.deepStrictEqual(decide({ seen: "1.1.0-alpha.6", current: "1.1.0-alpha.7" }), { show: true, from: "1.1.0-alpha.6" });
  assert.deepStrictEqual(decide({ seen: "1.1.0-alpha.7", current: "1.1.0-alpha.7" }), { show: false });
  assert.deepStrictEqual(decide({ seen: "1.1.0-alpha.8", current: "1.1.0-alpha.7" }), { show: false });
});

check("decide: nothing seen → only after an update that worked (a new install isn't greeted)", () => {
  assert.deepStrictEqual(decide({ current: "1.1.0-alpha.7" }), { show: false });
  assert.deepStrictEqual(decide({ current: "1.1.0-alpha.7", update: { version: "1.1.0-alpha.7", failed: false } }), { show: true, from: null });
  assert.deepStrictEqual(decide({ current: "1.1.0-alpha.7", update: { version: "1.1.0-alpha.7", failed: true } }), { show: false });
  assert.deepStrictEqual(decide({ current: "1.1.0-alpha.6", update: { version: "1.1.0-alpha.7", failed: false } }), { show: false });
});

check("render: bullets with continuation lines, bold, code, links to the repository's files", () => {
  const html = render(sections(MD)[0].text);
  assert.ok(html.includes("<li><strong>Three.</strong> Line one continues here.</li>"), html);
  assert.ok(html.includes("<code>code</code>"));
  assert.ok(html.includes('<a href="https://github.com/adithyakumarcr/kural/blob/main/docs/x.md">a doc</a>'));
});

check("render: the notes can't add HTML or other kinds of links", () => {
  const html = render('- <script>alert(1)</script> [x](javascript:alert(1)) `<b>` [y](../../etc)');
  assert.ok(!html.includes("<script>") && !html.includes("<b>") && !html.includes("javascript:") && !html.includes("../"), html);
  assert.ok(html.includes("&lt;script&gt;") && html.includes("<code>&lt;b&gt;</code>"));
});

check("the real RELEASE_NOTES.md has a block for this version, and it renders", () => {
  const md = fs.readFileSync(path.join(__dirname, "..", "RELEASE_NOTES.md"), "utf8");
  const version = require("../extension/package.json").version;
  const mine = between(md, null, version);
  assert.strictEqual(mine.length, 1, `no "## What's new in ${version}" block`);
  assert.ok(render(mine[0].text).includes("<li>"));
  assert.ok(!/Not released yet/.test(mine[0].text));
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);

// The chat page (media/chat.js) hands its helpers to the page's modules (KURAL_SIDE, KURAL_MARKDOWN, KURAL_LISTEN…).
// A name handed over that chat.js doesn't define is a ReferenceError the moment the page starts: the whole chat panel
// stays empty (it happened when the old markdown() moved to media/markdown.js and the side chat still asked for it).
const assert = require("assert");
const fs = require("fs"), path = require("path");
const src = fs.readFileSync(path.join(__dirname, "..", "extension", "media", "chat.js"), "utf8");

let failed = 0;
const check = (name, fn) => { try { fn(); console.log("ok  ", name); } catch (e) { failed++; console.error("FAIL", name, e.message); } };

const defined = (name) => new RegExp(`\\b(const|let|var|function)\\s+${name}\\b|[{,]\\s*${name}\\s*[,}]\\s*=|\\(\\s*${name}\\s*[,)]`).test(src);

check("every name chat.js hands to a page module is defined in chat.js", () => {
  const calls = [...src.matchAll(/window\.KURAL_[A-Z]+\(\{([\s\S]*?)\}\)/g)];
  assert.ok(calls.length >= 3, "the page's modules are created");
  const missing = [];
  for (const c of calls) {
    // Shorthand properties only ("{ el, icon, markdown, … }"); "name: value" pairs carry their own value.
    const props = c[1].replace(/\([^()]*\)/g, "").replace(/\{[^{}]*\}/g, "").split(",").map((s) => s.trim()).filter((s) => /^[A-Za-z_$][\w$]*$/.test(s));
    for (const p of props) if (!defined(p)) missing.push(p);
  }
  assert.deepStrictEqual(missing, []);
});

check("every page module chat.js uses is loaded before chat.js", () => {
  const media = path.join(__dirname, "..", "extension", "media");
  const html = fs.readFileSync(path.join(__dirname, "..", "extension", "lib", "chat", "index.js"), "utf8");
  const order = [...html.matchAll(/src="\$\{uri\("([\w.-]+\.js)"\)\}"/g)].map((m) => m[1]);
  assert.ok(order.includes("chat.js"), "the chat page's scripts are found");
  const missing = [];
  for (const [, name] of src.matchAll(/window\.(KURAL_[A-Z]+)\(/g)) {
    const file = fs.readdirSync(media).find((f) => f.endsWith(".js") && new RegExp(`window\\.${name}\\s*=`).test(fs.readFileSync(path.join(media, f), "utf8")));
    if (!file || !order.includes(file) || order.indexOf(file) > order.indexOf("chat.js")) missing.push(`${name} (${file || "no file"})`);
  }
  assert.deepStrictEqual([...new Set(missing)], []);
});

check("the developer notes (CLAUDE.md) describe the calm chat, not the old one-line thinking", () => {
  const notes = fs.readFileSync(path.join(__dirname, "..", "CLAUDE.md"), "utf8");
  assert.ok(!/Thinking is always ONE line/.test(notes), "the old one-line thinking is still described");
  for (const f of ["media/markdown.js", "media/timeline.js", "media/choices.js"]) assert.ok(notes.includes(f), f);
});

console.log(failed ? `chat-wiring: ${failed} FAILED` : "chat-wiring: ALL PASS");
process.exit(failed ? 1 : 0);

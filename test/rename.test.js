// Tab Completion's "also change it elsewhere": noticing that you changed a name (lib/tab/rename.js). A stand-in editor
// applies changes the way VS Code reports them (offset, length, text) and moves the cursor; the watcher says old → new
// once you're done with the word, and nothing for new words you're typing, keywords, or edits that aren't one word.
const assert = require("assert");
const { RenameWatch, narrow, wordAt, worthIt } = require("../extension/lib/tab/rename");

let fail = 0;
const check = (name, fn) => { try { fn(); console.log("ok  ", name); } catch (e) { fail++; console.log("FAIL", name, e.stack); } };

// A document you edit: change(offset, length, text) like VS Code's contentChanges; typing = one key at a time.
function editor(text, opts) {
  const w = new RenameWatch(opts);
  let now = 1000000;
  const out = [];
  const ed = {
    get text() { return text; },
    w, out,
    wait(ms) { now += ms; const r = w.tick("doc", text, now); if (r) out.push(r); return ed; },
    change(offset, length, insert) {
      const before = text;
      text = text.slice(0, offset) + insert + text.slice(offset + length);
      const r = w.edit("doc", before, text, { offset, length, text: insert }, now);
      if (r) out.push(r);
      now += 120;
      return ed;
    },
    type(offset, s) { for (const ch of s) { ed.change(offset, 0, ch); offset++; } return ed; },
    cursor(offset) { const r = w.cursor("doc", text, offset, now); if (r) out.push(r); return ed; },
    renames() { return out.map((r) => `${r.from}->${r.to}`); },
  };
  return ed;
}
const SRC = "let count = 0;\nfunction add() { count += 1; }\nexport { count };\n";

check("typing over a name (select it, type the new one), then a pause: count → total", () => {
  const e = editor(SRC);
  e.wait(60000);                                  // (your last edit was long ago)
  e.change(4, 5, "t").type(5, "otal").wait(1600);
  assert.deepStrictEqual(e.renames(), ["count->total"]);
  assert.ok(e.text.startsWith("let total = 0;"));
});
check("backspace at the end and type more: count → counter, done when the cursor leaves the word", () => {
  const e = editor(SRC).wait(60000);
  e.change(8, 1, "").type(8, "ter");             // "coun" + "ter"
  assert.deepStrictEqual(e.renames(), []);
  e.cursor(9 + 2);                               // still inside the word: not yet
  assert.deepStrictEqual(e.renames(), []);
  e.cursor(0);
  assert.deepStrictEqual(e.renames(), ["count->counter"]);
});
check("select, delete, then type the new name: one rename", () => {
  const e = editor(SRC).wait(60000);
  e.change(4, 5, "").type(4, "total").wait(2000);
  assert.deepStrictEqual(e.renames(), ["count->total"]);
});
check("a key that isn't part of a name ends the word at once: total( → count → total", () => {
  const e = editor(SRC).wait(60000);
  e.change(4, 5, "total").change(9, 0, " ");
  assert.deepStrictEqual(e.renames(), ["count->total"]);
});
check("a new name typed letter by letter isn't a rename (nothing was there before)", () => {
  const e = editor("x = 1\n").wait(60000);
  e.type(6, "userName").wait(2000);
  assert.deepStrictEqual(e.renames(), []);
});
check("a word you just typed, carried on within a few seconds, isn't a rename either", () => {
  const e = editor("x = 1\n").wait(60000);
  e.type(6, "user").wait(2000).type(10, "Name").wait(2000);
  assert.deepStrictEqual(e.renames(), []);
});
check("accepting a Tab suggestion that changes a name: VS Code replaces the rest of the line, only 'er' really changed", () => {
  const e = editor("total = count) {\n").wait(60000);
  // cursor after "count"; the suggestion "er" + the rest of the line ") {" replaces ") {"
  e.change(13, 3, "er) {");
  assert.deepStrictEqual(narrow("total = count) {\n", { offset: 13, length: 3, text: "er) {" }), { offset: 13, length: 0, text: "er" });
  e.cursor(e.text.indexOf("\n"));                // the cursor goes to the end of the line
  assert.deepStrictEqual(e.renames(), ["count->counter"]);
});
check("keywords and single letters aren't offered: let → const, string → number, i → j", () => {
  const e = editor("let a: string = 1;\nfor (i of x) {}\n").wait(60000);
  e.change(0, 3, "const").wait(2000);
  e.wait(60000).change(e.text.indexOf("string"), 6, "number").wait(2000);
  e.wait(60000).change(e.text.indexOf("i of"), 1, "j").wait(2000);
  assert.deepStrictEqual(e.renames(), []);
  assert.strictEqual(worthIt("count", "total"), true);
  assert.strictEqual(worthIt("count", "count"), false);
  assert.strictEqual(worthIt("count", "9x"), false);
});
check("an edit that isn't one word (a paste with spaces, a deleted line) follows nothing", () => {
  const e = editor(SRC).wait(60000);
  e.change(4, 5, "a b").wait(2000);
  e.wait(60000).change(0, SRC.indexOf("\n") + 1, "").wait(2000);
  assert.deepStrictEqual(e.renames(), []);
});
check("changed back to what it was: nothing to offer", () => {
  const e = editor(SRC).wait(60000);
  e.change(4, 5, "c").type(5, "ount").wait(2000);
  assert.deepStrictEqual(e.renames(), []);
});
check("Unicode names: größe → breite", () => {
  const e = editor("const größe = 1;\nuse(größe);\n").wait(60000);
  e.change(6, 5, "breite").wait(2000);
  assert.deepStrictEqual(e.renames(), ["größe->breite"]);
  assert.deepStrictEqual(wordAt("a.größe+1", 3), { start: 2, end: 7, word: "größe" });
});
check("two documents are followed separately", () => {
  const w = new RenameWatch();
  w.edit("a", "let count = 1", "let total = 1", { offset: 4, length: 5, text: "total" }, 100000);
  w.edit("b", "let x = 1", "let xy = 1", { offset: 5, length: 0, text: "y" }, 100000);
  assert.deepStrictEqual(w.tick("a", "let total = 1", 102000), { uri: "a", from: "count", to: "total" });
  assert.strictEqual(w.tick("b", "let xy = 1", 102000), null);   // a one-letter name (x) isn't offered
});
console.log(fail ? `rename: ${fail} FAILED` : "rename: ALL PASS");
process.exit(fail ? 1 : 0);

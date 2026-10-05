// Code colors in chat answers (media/chat.js highlight()): run outside the page, spans shown as [class:text].
const assert = require("assert");
const fs = require("fs"), path = require("path");
const src = fs.readFileSync(path.join(__dirname, "..", "extension", "media", "chat.js"), "utf8");
const a = src.indexOf("const KW_DECL"), b = src.indexOf("  function codeCard");
const el = (t, p, x) => ({ cls: p.class, x });
const highlight = new Function("el", src.slice(a, b) + "; return highlight;")(el);
const show = (code, lang) => highlight(code, lang).map((n) => typeof n === "string" ? n : `[${n.cls}:${n.x}]`).join("");

let fail = 0;
const check = (name, fn) => { try { fn(); console.log("ok  ", name); } catch (e) { fail++; console.log("FAIL", name, e.message); } };
check("JavaScript: keywords, calls, strings, numbers, comments", () =>
  assert.strictEqual(show('const x = await fetch("a", 42); // hi', "js"), '[tk-k:const] x = [tk-x:await] [tk-f:fetch]([tk-s:"a"], [tk-n:42]); [tk-c:// hi]'));
check("Python: # comments, docstrings, f-strings, None", () =>
  assert.strictEqual(show("def f(a):\n    \"\"\"doc\"\"\"\n    return None  # c\nprint(f'x')", "python"),
    "[tk-k:def] [tk-f:f](a):\n    [tk-s:\"\"\"doc\"\"\"]\n    [tk-x:return] [tk-l:None]  [tk-c:# c]\n[tk-f:print]([tk-s:f'x'])"));
check("not a string: an apostrophe in a word, Rust's 'a", () => {
  assert.strictEqual(show("Error: Can't find it", ""), "[tk-t:Error]: [tk-t:Can]'t find it");
  assert.strictEqual(show("fn f<'a>(x: &'a str)", "rust"), "[tk-k:fn] f<'a>(x: &'a str)");
});
check("shell: # inside a word isn't a comment", () => assert.strictEqual(show("curl https://x.com/#a  # go", "sh"), "curl https://x.com/#a  [tk-c:# go]"));
check("plain text and output stay plain", () => assert.deepStrictEqual(highlight("if x then", "text"), ["if x then"]));
console.log(fail ? `highlight: ${fail} FAILED` : "highlight: ALL PASS");
process.exit(fail ? 1 : 0);

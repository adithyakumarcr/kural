// Chat answers' inline markdown (media/chat.js inline()): HTML made for code, pictures and links must never be
// rewritten by a later rule (APP-5: a link inside a picture's alt text broke out of the alt="…" attribute).
const assert = require("assert");
const fs = require("fs"), path = require("path");
const src = fs.readFileSync(path.join(__dirname, "..", "extension", "media", "chat.js"), "utf8");
const esc = src.slice(src.indexOf("  const esc = "), src.indexOf("\n", src.indexOf("  const esc = ")));
const body = src.slice(src.indexOf("  function fileSrc"), src.indexOf("  // \"| a | b |\""));
const inline = new Function("S", `${esc}\n${body}\nreturn inline;`)({ pics: { base: "https://file+.vscode-resource.vscode-cdn.net", root: "/proj", home: "/home/u" } });

// Every tag's attributes, read the way a browser tokenizer would (name="value" pairs only).
function tags(html) {
  const out = [];
  for (const m of html.matchAll(/<([a-z]+)((?:\s+[a-z-]+="[^"]*")*)\s*>/g)) out.push({ tag: m[1], attrs: [...m[2].matchAll(/([a-z-]+)="/g)].map((a) => a[1]) });
  return out;
}
// No quote or "<" inside an attribute value, and no "<" left over that isn't a whole known tag.
function wellFormed(html) {
  const stripped = html.replace(/<\/?(a|img|span|code|strong|em)(\s+[a-z-]+="[^"<>]*")*\s*>/g, "");
  assert.ok(!/[<>]/.test(stripped), `stray markup in: ${html}`);
}

let fail = 0;
const check = (name, fn) => { try { fn(); console.log("ok  ", name); } catch (e) { fail++; console.log("FAIL", name, e.message); } };

check("audit fuzz 1: a link inside a picture's alt stays text", () => {
  const h = inline("![a[b](x.png) more](https://evil.example/c)");
  wellFormed(h);
  const img = tags(h).find((t) => t.tag === "img");
  assert.ok(img, h);
  assert.deepStrictEqual(img.attrs, ["class", "src", "data-path", "alt", "title"]);
  assert.ok(!/alt="[^"]*<a /.test(h), h);
});
check("audit fuzz 2: code in a picture's alt doesn't add attributes", () => {
  const h = inline("![`a.js` x](https://e.example/i.png)");
  wellFormed(h);
  for (const t of tags(h)) assert.ok(!t.attrs.includes("data-path") || t.tag === "code", JSON.stringify(t));
  assert.ok(!/data-alt="[^"]*<code/.test(h), h);
});
check("quotes and angle brackets in alt, link text and addresses are escaped", () => {
  for (const s of ['![x" onerror="y](a.png)', '[t"x](https://a.example/"><b>)', '`"a"` **"b"** https://a.example/"x', "![a](x.png\u00003\u0000)"]) wellFormed(inline(s));
});
check("ordinary markdown still renders", () => {
  assert.strictEqual(inline("`a.js:12`"), '<code class="ref" data-path="a.js" data-line="12">a.js:12</code>');
  assert.strictEqual(inline("**b** and *i*"), "<strong>b</strong> and <em>i</em>");
  assert.strictEqual(inline("[site](https://a.example)"), '<a class="link" data-url="https://a.example" title="https://a.example">site</a>');
  assert.strictEqual(inline("[**x**](https://a.example)"), '<a class="link" data-url="https://a.example" title="https://a.example"><strong>x</strong></a>');
  assert.strictEqual(inline("see https://a.example/x."), 'see <a class="link" data-url="https://a.example/x">https://a.example/x</a>.');
  assert.strictEqual(inline("**https://a.example**"), '<strong><a class="link" data-url="https://a.example">https://a.example</a></strong>');
  assert.strictEqual(inline("go to www.a.example"), 'go to <a class="link" data-url="https://www.a.example">www.a.example</a>');
  assert.strictEqual(inline("`![x](y.png)`"), "<code>![x](y.png)</code>");
  assert.ok(inline("[the file](src/app.js#L3)").startsWith('<a class="link file" data-path="src/app.js" data-line="3"'));
  assert.ok(inline("![pic](shot.png)").startsWith('<img class="md-img" src="https://file+.vscode-resource.vscode-cdn.net/proj/shot.png"'));
});
console.log(fail ? `markdown-inline: ${fail} FAILED` : "markdown-inline: ALL PASS");
process.exit(fail ? 1 : 0);

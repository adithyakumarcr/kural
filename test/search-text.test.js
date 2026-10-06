// The Search tab's text search (extension/lib/search/text.js): include/exclude globs, ripgrep's results, unsaved text
// searched in memory, and replacing ($1, \u, Preserve Case). With the real ripgrep when one is around (VS Code's own
// in a built Kural, or rg on PATH); otherwise those checks are skipped.
const assert = require("assert");
const fs = require("fs"), os = require("os"), path = require("path");
const { spawnSync } = require("child_process");
const T = require("../extension/lib/search/text");

let fail = 0;
const check = async (name, fn) => { try { await fn(); console.log("ok  ", name); } catch (e) { fail++; console.log("FAIL", name, e.message); } };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kural-search-test-"));

function findRg() {
  if (process.env.KURAL_RG) return process.env.KURAL_RG;
  const built = path.join(__dirname, "..", "kural", "build", "mac", "dmg", "Kural.app", "Contents", "Resources", "app");
  const p = T.rgPath(built);
  if (fs.existsSync(p)) return p;
  return spawnSync("rg", ["--version"]).status === 0 ? "rg" : null;
}

(async () => {
  await check("include/exclude boxes become globs the way VS Code reads them", async () => {
    assert.deepStrictEqual(T.toGlobs("*.ts"), ["**/*.ts"]);
    assert.deepStrictEqual(T.toGlobs("src"), ["**/src", "**/src/**"]);
    assert.deepStrictEqual(T.toGlobs("./src/lib, *.{js,ts}"), ["src/lib", "src/lib/**", "**/*.{js,ts}"]);
    assert.deepStrictEqual(T.toGlobs("docs/*.md"), ["docs/*.md"]);
    assert.deepStrictEqual(T.toGlobs(" , "), []);
    assert.deepStrictEqual(T.settingGlobs({ "**/node_modules": true, "**/*.js": { when: "$(basename).ts" }, "**/x": false }, { "**/.git": true }), ["**/node_modules", "**/.git"]);
  });

  await check("ripgrep's arguments follow the toggles", async () => {
    const a = T.rgArgs({ pattern: "Foo", matchCase: false, smartCase: true, wholeWord: true, include: "*.js", exclude: "dist", excludeGlobs: ["**/node_modules"] });
    assert.ok(a.includes("--case-sensitive"), "smart case with a capital letter");
    assert.ok(a.includes("--fixed-strings") && a.includes("--word-regexp") && a.includes("--follow"));
    assert.ok(a.join(" ").includes("-g **/*.js") && a.join(" ").includes("-g !**/dist") && a.join(" ").includes("-g !**/node_modules"));
    const b = T.rgArgs({ pattern: "a\\nb", isRegex: true, useIgnore: false, excludeGlobs: ["**/node_modules"] });
    assert.ok(b.includes("--multiline") && b.includes("--no-ignore") && !b.join(" ").includes("node_modules") && !b.includes("--fixed-strings"));
  });

  await check("unsaved text is searched like ripgrep would", async () => {
    const text = "const a = 1;\nlet ab = a + 1; // a\r\nfoo(a)\n";
    const m = T.searchText(text, { pattern: "a", wholeWord: true });
    assert.deepStrictEqual(m.map((x) => [x.line, x.col]), [[1, 6], [2, 9], [2, 19], [3, 4]]);
    assert.strictEqual(m[1].text, "let ab = a + 1; // a", "no \\r in the line shown");
    const ml = T.searchText("one\ntwo\nthree", { pattern: "o\\nt", isRegex: true });
    assert.deepStrictEqual([ml[0].line, ml[0].col, ml[0].endLine, ml[0].endCol], [2, 2, 3, 1]);
    assert.throws(() => T.searchText("x", { pattern: "(", isRegex: true }), SyntaxError);
  });

  await check("replacing: groups, case changes, \\n, Preserve Case", async () => {
    const m = /(\w+)-(\w+)/.exec("hello-world");
    assert.strictEqual(T.expand("$2 $1 $& $0 $$", m), "world hello hello-world hello-world $");
    assert.strictEqual(T.expand("\\u$1 \\U$2\\n\\t\\\\", m), "Hello WORLD\n\t\\");
    assert.strictEqual(T.replacement(["FOO"], { preserveCase: true }, "bar"), "BAR");
    assert.strictEqual(T.replacement(["Foo"], { preserveCase: true }, "bar"), "Bar");
    assert.strictEqual(T.replacement(["foo-Bar"], { preserveCase: true }, "baz-qux"), "baz-Qux");
    assert.strictEqual(T.replacement(["a$1"], {}, "$1x"), "$1x", "plain text: as typed");
    const r = T.replaceIn("let foo = foo2; foo", [{ offset: 4, match: "foo" }, { offset: 16, match: "foo" }, { offset: 10, match: "nope" }], { pattern: "foo", wholeWord: true }, "bar");
    assert.deepStrictEqual(r, { text: "let bar = foo2; bar", done: 2, skipped: 1 });
    const g = T.replaceIn("width: 10px; height: 20px", T.searchText("width: 10px; height: 20px", { pattern: "(\\d+)px", isRegex: true }).map((x) => ({ offset: x.col, match: x.match })), { pattern: "(\\d+)px", isRegex: true }, "${1}rem");
    assert.strictEqual(g.text, "width: ${1}rem; height: ${1}rem", "(VS Code doesn't read ${1} either)");
  });

  const rg = findRg();
  await check("ripgrep: results per file, character columns, excludes and the limit", async () => {
    if (!rg) return console.log("     (skipped: no ripgrep here)");
    fs.mkdirSync(path.join(tmp, "src"), { recursive: true });
    fs.mkdirSync(path.join(tmp, "node_modules"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "src", "a.js"), "const naïve = 'Pause';\nfunction pause() { return 'pause'; }\n");
    fs.writeFileSync(path.join(tmp, "src", "b.txt"), "nothing\nPAUSE here\n");
    fs.writeFileSync(path.join(tmp, "node_modules", "x.js"), "pause\n");
    const got = {};
    const run = (q, opts) => { for (const k of Object.keys(got)) delete got[k]; return T.runRg(rg, tmp, T.rgArgs(q), (f, m) => { got[path.relative(tmp, f)] = m; }, opts).job; };
    let r = await run({ pattern: "pause", excludeGlobs: ["**/node_modules"] });
    assert.strictEqual(r.error, null);
    assert.deepStrictEqual(Object.keys(got).sort(), [path.join("src", "a.js"), path.join("src", "b.txt")]);
    assert.deepStrictEqual(got[path.join("src", "a.js")].map((m) => [m.line, m.col, m.match]), [[1, 15, "Pause"], [2, 9, "pause"], [2, 27, "pause"]], "columns count characters (naïve)");
    r = await run({ pattern: "pause", matchCase: true, include: "*.js" });
    assert.deepStrictEqual(Object.keys(got).sort(), [path.join("node_modules", "x.js"), path.join("src", "a.js")]);
    r = await run({ pattern: "pause" }, { max: 2 });
    assert.ok(r.limited, "stops at the limit");
    r = await run({ pattern: "(", isRegex: true });
    assert.ok(r.error, "a broken regex says why");
  });

  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(fail ? 1 : 0);
})();

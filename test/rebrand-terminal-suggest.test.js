// The terminal's suggestion list matches only from the start of a name (issue #106: "git push ori" listed ./.dockerignore
// and ./.python-version, matching o…r…i anywhere). scripts/rebrand.py terminal_suggest_prefix.
//   1. on a stand-in with the shape of VS Code 1.140's terminal completion model (runs everywhere),
//   2. on a real workbench file when one is around.
const assert = require("assert");
const fs = require("fs"), path = require("path");
const vm = require("vm");
const { spawnSync } = require("child_process");

let fail = 0;
const check = (name, fn) => { try { fn(); console.log("ok  ", name); } catch (e) { fail++; console.log("FAIL", name, e.message); } };
const root = path.join(__dirname, "..");
const py = (code, input) => spawnSync("python3", ["-c", `import sys\nsys.path.insert(0, ${JSON.stringify(path.join(root, "scripts"))})\nimport rebrand\n${code}`], { input, encoding: "utf8", maxBuffer: 1 << 28 });
const patch = (text) => py("import sys\nsys.stdout.write(rebrand.terminal_suggest_prefix(sys.stdin.read()))", text);

// VS Code's model as minified in 1.140 (only what filtering needs). VR stands in for its fuzzy scorer: the letters in
// order anywhere (what firstMatchCanBeWeak allows). The editor's suggest model has the same scorer call: it must stay.
const STAND_IN = 'var lq={default:{boostFullMatch:!0,firstMatchCanBeWeak:!1}},ly={Default:[-100,0]};' +
  'function VR(s,o,e,t,i){let j=e;for(let k=0;k<i.length&&j<o.length;k++)if(i[k]===o[j])j++;return j===o.length?[1,0]:void 0}' +
  'var EditorModel=class{constructor(){this._fuzzyScoreOptions=lq.default}score(i,n,g,u){let f=VR(i,n,g,u.textLabel,u.labelLow,0,this._fuzzyScoreOptions);return!!f}};' +
  'var p_i=class{constructor(o,e,t){this._items=o;this._lineContext=e;this._rawCompareFn=t;this._refilterKind=1;this._fuzzyScoreOptions={...lq.default,firstMatchCanBeWeak:!0};this._options={}}' +
  'get items(){return this._createCachedState(),this._filteredItems}' +
  '_createCachedState(){let o=[],{leadingLineContent:e,characterCountDelta:t}=this._lineContext,i="",n="",r=this._items,a=[],c=VR;for(let l=0;l<r.length;l++){let u=r[l];if(u.isInvalid)continue;' +
  'let p=u.completion.replacementRange?u.completion.replacementRange[1]-u.completion.replacementRange[0]:0,m=p+t;if(i.length!==m&&(i=m===0?"":e.slice(-m),n=i.toLowerCase()),u.word=i,m===0)u.score=ly.Default;' +
  'else{let g=0;for(;g<p;){let f=i.charCodeAt(g);if(f===32||f===9)g+=1;else break}if(g>=m)u.score=ly.Default;else{let f=c(i,n,g,u.textLabel,u.labelLow,0,this._fuzzyScoreOptions);if(!f&&i!=="")continue;u.score=f||ly.Default}}' +
  'u.idx=l,a.push(u),o.push(u.textLabel.length)}this._filteredItems=a,this._refilterKind=0}};';

// What's left of these items when the line ends with `typed` (each item replaces the last `typed.length` characters,
// as VS Code's file and argument items do; `whole` ones replace the whole line, `none` ones nothing: Kural's).
function shown(code, line, labels, typedLen) {
  const sandbox = {};
  vm.runInNewContext(`${code};M=p_i;E=EditorModel`, sandbox);
  const items = labels.map((x) => {
    const label = typeof x === "string" ? x : x.label, range = typeof x === "string" ? [line.length - typedLen, line.length] : x.range;
    return { textLabel: label, labelLow: label.toLowerCase(), completion: { replacementRange: range } };
  });
  return Array.from(new sandbox.M(items, { leadingLineContent: line, characterCountDelta: 0 }).items, (u) => u.textLabel);   // (an array of this realm)
}

const r = patch(STAND_IN);
const FILES = ["./.dockerignore", "./.python-version", "origin", "./orientation.md", "./docs/"];
check("the stand-in is patched once, with no warning", () => {
  assert.strictEqual(r.status, 0, r.stderr); assert.strictEqual(r.stdout.split("kural-prefix").length - 1, 1); assert.ok(!/warning/.test(r.stdout + r.stderr));
});
check("unpatched: \"ori\" matches letters anywhere (the bug)", () => {
  assert.deepStrictEqual(shown(STAND_IN, "git push ori", FILES, 3), ["./.dockerignore", "./.python-version", "origin", "./orientation.md"]);
});
check("patched: only names that start with \"ori\" (also after ./)", () => {
  assert.deepStrictEqual(shown(r.stdout, "git push ori", FILES, 3), ["origin", "./orientation.md"]);
});
check("case doesn't matter; ./ typed or not both work", () => {
  assert.deepStrictEqual(shown(r.stdout, "cd DO", FILES, 2), ["./docs/"]);
  assert.deepStrictEqual(shown(r.stdout, "cd ./do", FILES, 4), ["./docs/"]);
  assert.deepStrictEqual(shown(r.stdout, "cat .d", FILES, 2), ["./.dockerignore"]);
});
check("nothing typed yet: everything stays", () => assert.deepStrictEqual(shown(r.stdout, "git push ", FILES, 0), FILES));
check("Kural's own items stay: a whole line that starts with it, and a reworded one that replaces nothing", () => {
  const items = [{ label: "git push origin main", range: [0, 12] }, { label: "git push -u origin fix", range: [12, 12] }];
  assert.deepStrictEqual(shown(r.stdout, "git push ori", items), ["git push origin main", "git push -u origin fix"]);
});
check("the editor's own suggest model is left alone", () => assert.ok(r.stdout.includes("score(i,n,g,u){let f=VR(")));
check("applying it again changes nothing", () => assert.strictEqual(patch(r.stdout).stdout, r.stdout));
check("code without the pattern is left alone, with a warning", () => { const x = patch("var a=1;"); assert.ok(x.stdout.endsWith("var a=1;") && /::warning::/.test(x.stdout), x.stdout); });

const src = require("./workbench").findWorkbench();
if (!src) console.log("(real workbench file: skipped: no built workbench (set KURAL_WORKBENCH))");
else {
  const text = fs.readFileSync(src, "utf8");
  if (text.includes("kural-prefix")) console.log("(real workbench file: already patched; checking it)");
  const real = text.includes("kural-prefix") ? { stdout: text, stderr: "", status: 0 } : patch(text);
  check("the patch matches the real workbench file once, without warnings", () => {
    assert.strictEqual(real.status, 0); assert.ok(!/::warning::/.test(real.stderr + real.stdout.slice(0, 2000)));
    assert.strictEqual(real.stdout.split("kural-prefix").length - 1, 1);
  });
  check("...right before the terminal model's scorer call, which is still there", () => {
    const i = real.stdout.indexOf("/*kural-prefix*/");
    const after = real.stdout.slice(i, i + 400);
    assert.ok(/continue;let [\w$]+=[\w$]+\([\w$]+,[\w$]+,[\w$]+,[\w$]+\.textLabel,[\w$]+\.labelLow,0,this\._fuzzyScoreOptions\);/.test(after), after);
    const model = real.stdout.lastIndexOf("firstMatchCanBeWeak:!0};this._options={}}", i);
    assert.ok(model > 0 && i - model < 4000);
  });
  check("...and the patched file still parses", () => {
    if (text.includes("kural-prefix")) return;
    // (Only the patched stretch: the whole file is an ES module with imports.)
    const i = real.stdout.indexOf("/*kural-prefix*/"), start = real.stdout.lastIndexOf("_createCachedState(){", i);
    let depth = 0, end = start;
    for (let k = real.stdout.indexOf("{", start); k < real.stdout.length; k++) { const ch = real.stdout[k]; if (ch === "{") depth++; else if (ch === "}" && --depth === 0) { end = k + 1; break; } }
    new vm.Script(`({${real.stdout.slice(start, end)}})`);
  });
}
console.log(fail ? `rebrand-terminal-suggest: ${fail} FAILED` : "rebrand-terminal-suggest: ALL PASS");
process.exit(fail ? 1 : 0);

// Tab Completion's "also change it elsewhere" (lib/tab/rename-offer.js), on a small project in a temp folder, with a
// stand-in editor and the real ripgrep when one is around (an installed or built Kural, or rg on PATH; skipped otherwise):
// the offer's words, Review (Search & Ask filled in), Change all (every place in one edit; saved files saved), and what
// isn't counted (node_modules, dist, build, prose like a README, another word that contains the name, other cases).
const assert = require("assert");
const fs = require("fs"), os = require("os"), path = require("path"), Module = require("module");
const { spawnSync } = require("child_process");
const T = require("../extension/lib/search/text");

let fail = 0;
const check = async (name, fn) => { try { await fn(); console.log("ok  ", name); } catch (e) { fail++; console.log("FAIL", name, e.stack); } };

const found = require("./workbench").findAppRoot();
const appRoot = (found && fs.existsSync(T.rgPath(found)) ? found : null) || (spawnSync("rg", ["--version"]).status === 0 ? "/nowhere" : null);
if (!appRoot) { console.log("(skipped: no ripgrep here; set KURAL_WORKBENCH or put rg on PATH)"); process.exit(0); }

// ---------- a small project ----------
const root = fs.mkdtempSync(path.join(os.tmpdir(), "kural-rename-offer-"));
const put = (rel, text) => { const f = path.join(root, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); return f; };
const main = put("src/cart.js", "let total = 0;\nfunction add(p) { total += p; return count; }\n");   // (count was just renamed to total in line 1)
put("src/report.js", "import { count } from './cart';\nconsole.log(count, countAll, Count);\n");
put("src/ui/view.js", "export const label = () => `items: ${count}`;\n");
put("node_modules/lib/index.js", "module.exports = count;\n");
put("dist/bundle.js", "var count=1;\n");
put("build/out.js", "count\n");
put("README.md", "The count of items.\n");

// ---------- a stand-in editor ----------
class Position { constructor(line, character) { this.line = line; this.character = character; } }
class Range { constructor(a, b) { this.start = a; this.end = b; } }
function doc(file) {
  let text = fs.readFileSync(file, "utf8");
  const d = {
    uri: { scheme: "file", fsPath: file, toString: () => `file://${file}` }, languageId: "javascript", isDirty: false,
    getText: () => text, set: (t) => { text = t; d.isDirty = true; },
    offsetAt: (p) => { const lines = text.split("\n"); let o = 0; for (let i = 0; i < p.line; i++) o += lines[i].length + 1; return o + p.character; },
    positionAt: (o) => { const before = text.slice(0, o).split("\n"); return new Position(before.length - 1, before[before.length - 1].length); },
    save: async () => { fs.writeFileSync(file, text); d.isDirty = false; d.saved = true; return true; },
  };
  return d;
}
const docs = new Map();
const open = (file) => { if (!docs.has(file)) docs.set(file, doc(file)); return docs.get(file); };
const current = open(main);
current.isDirty = true;   // (you're editing it)
const shown = [], searches = [];
let answer = null;
class WorkspaceEdit { constructor() { this.edits = []; } replace(uri, range, text) { this.edits.push({ uri, range, text }); } }
const vscode = {
  Position, Range, WorkspaceEdit, Uri: { file: (f) => ({ scheme: "file", fsPath: f, toString: () => `file://${f}` }) },
  env: { appRoot },
  workspace: {
    get textDocuments() { return [...docs.values()]; },
    getConfiguration: () => ({ get: (k, d) => d }),
    openTextDocument: async (u) => open(u.fsPath),
    applyEdit: async (edit) => {
      const byDoc = new Map();
      for (const e of edit.edits) { const d = open(e.uri.fsPath); if (!byDoc.has(d)) byDoc.set(d, []); byDoc.get(d).push(e); }
      for (const [d, list] of byDoc) {
        let text = d.getText();
        for (const e of list.sort((a, b) => d.offsetAt(b.range.start) - d.offsetAt(a.range.start))) text = text.slice(0, d.offsetAt(e.range.start)) + e.text + text.slice(d.offsetAt(e.range.end));
        d.set(text);
      }
      return true;
    },
  },
  window: { showInformationMessage: async (m, ...buttons) => { shown.push({ m, buttons }); return answer; }, setStatusBarMessage: () => {}, showErrorMessage: () => {} },
};
const load = Module._load;
Module._load = function (r, ...a) { return r === "vscode" ? vscode : load.call(this, r, ...a); };
require("../extension/lib/workspace").folders = () => [{ path: root }];
const ws = require("../extension/lib/workspace");
ws.label = (abs) => abs.startsWith(root + path.sep) ? path.relative(root, abs) : abs;
const { RenameOffers } = require("../extension/lib/tab/rename-offer");
const offers = new RenameOffers({ subscriptions: [] }, { show: async (tab, extra) => { searches.push({ tab, ...extra }); } });

(async () => {
  await check("where the old name is still used: this file (in the editor, not on disk), other files; not node_modules, dist, build", async () => {
    current.set("let total = 0;\nfunction add(p) { total += p; return count; }\n");
    const u = await offers.uses("count", current);
    const rel = (m) => [...m.keys()].map((f) => path.relative(root, f)).sort();
    assert.deepStrictEqual(rel(u.files), ["src/cart.js", "src/report.js", "src/ui/view.js"]);
    assert.strictEqual(u.here, 1);
    assert.strictEqual(u.total, 1 + 2 + 1);   // (countAll and Count aren't count)
  });
  await check("the offer says where: this file and the other files, with the places; Not now changes nothing", async () => {
    answer = "Not now";
    await offers.offer({ uri: current.uri.toString(), from: "count", to: "total" });
    assert.strictEqual(shown.length, 1);
    assert.strictEqual(shown[0].m, '"count" became "total" here. Also change it in this file (1 place) and 2 other files (3 places)?');
    assert.deepStrictEqual(shown[0].buttons, ["Review", "Change all", "Not now"]);
    assert.ok(/count, countAll, Count/.test(fs.readFileSync(path.join(root, "src/report.js"), "utf8")));
  });
  await check("the same rename isn't offered twice in a window", async () => {
    await offers.offer({ uri: current.uri.toString(), from: "count", to: "total" });
    assert.strictEqual(shown.length, 1);
  });
  await check("Review: Search & Ask filled in (old name, Match Case + Whole Word, replace with the new one)", async () => {
    answer = "Review";
    put("src/more.js", "const amount = 1;\nexport default amount;\n");
    await offers.offer({ uri: current.uri.toString(), from: "amount", to: "price" });
    const s = searches.pop();
    assert.deepStrictEqual({ ...s.query, exclude: undefined }, { pattern: "amount", isRegex: false, matchCase: true, wholeWord: true, replace: "price", exclude: undefined });
    assert.ok(s.tab === "text" && /node_modules/.test(s.query.exclude) && /\*\.md/.test(s.query.exclude));   // (the same places as counted)
    assert.strictEqual(shown[1].m, '"amount" became "price" here. Also change it in 1 other file (2 places)?');
  });
  await check("Change all: every place in one edit, whole words only; files without unsaved changes are saved, yours stays unsaved", async () => {
    answer = "Change all";
    await offers.offer({ uri: current.uri.toString(), from: "count", to: "tally" });
    assert.strictEqual(fs.readFileSync(path.join(root, "src/report.js"), "utf8"), "import { tally } from './cart';\nconsole.log(tally, countAll, Count);\n");
    assert.strictEqual(fs.readFileSync(path.join(root, "src/ui/view.js"), "utf8"), "export const label = () => `items: ${tally}`;\n");
    assert.strictEqual(current.getText(), "let total = 0;\nfunction add(p) { total += p; return tally; }\n");
    assert.ok(current.isDirty && !current.saved);                       // (the file you're editing: you save it)
    assert.strictEqual(fs.readFileSync(path.join(root, "node_modules/lib/index.js"), "utf8"), "module.exports = count;\n");
    assert.strictEqual(fs.readFileSync(path.join(root, "dist/bundle.js"), "utf8"), "var count=1;\n");
  });
  await check("nothing left to change: no offer at all", async () => {
    const before = shown.length;
    await offers.offer({ uri: current.uri.toString(), from: "nowhereUsed", to: "other" });
    assert.strictEqual(shown.length, before);
  });
  await check("Kural's own Change all doesn't look like your typing (no offer from it)", () => {
    assert.strictEqual(offers.applying, false);
    const src = fs.readFileSync(path.join(__dirname, "..", "extension", "lib", "tab", "rename-offer.js"), "utf8");
    assert.ok(/this\.applying = true;\s*let ok = false;\s*try \{ ok = await vscode\.workspace\.applyEdit\(edit\); \} finally \{ this\.applying = false; \}/.test(src));
    assert.ok(/if \(!this\.on\(\) \|\| this\.applying \|\| e\.reason !== undefined \|\| e\.contentChanges\.length !== 1/.test(src));
  });
  fs.rmSync(root, { recursive: true, force: true });
  console.log(fail ? `rename-offer: ${fail} FAILED` : "rename-offer: ALL PASS");
  process.exit(fail ? 1 : 0);
})();

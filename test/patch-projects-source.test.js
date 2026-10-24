// The Projects bar's four patches as SOURCE patches (patches/kural/02xx-*.patch, made against VS Code's own TypeScript at the commit
// VSCodium 1.140.06880 builds from) and how scripts/rebrand.py steps aside for them.
//
// What was checked where:
//   * Always: the four files exist, are well-formed unified diffs (every hunk's line counts add up) and touch only src/vs/.
//   * With KURAL_VSCODE_SRC (a pristine checkout of that commit; skipped with a note without one): each patch passes `git apply --check`
//     alone, and the four together, in order. (Checked 24 Oct 2026 against 07f806f9; with them applied `tsc -p src/tsconfig.json`
//     reported nothing in the touched files and eslint nothing on the new one. The card's code was also transpiled and run on a tiny
//     DOM with a fake clock: same results as the rebrand.py version in test/rebrand-projects.test.js.)
//   * Always: rebrand.py's patch_workbench on a stand-in app folder. Without product.json "kuralSource" the four rebrand functions run
//     as before; with it, exactly the ones whose source patch is listed are skipped, each with one line saying so.
//   * NOT checked: the built app (needs the source build: scripts/vscode/build.sh).
const assert = require("assert");
const fs = require("fs"), os = require("os"), path = require("path");
const { spawnSync } = require("child_process");

let fail = 0;
const check = async (name, fn) => { try { await fn(); console.log("ok  ", name); } catch (e) { fail++; console.log("FAIL", name, e.message); } };
const root = path.join(__dirname, "..");
const dir = path.join(root, "patches", "kural");
const NAMES = ["0200-drop-explorer-empty-view", "0201-projects-default-view", "0202-projects-always-shown", "0203-in-window-card"];
const file = (n) => path.join(dir, n + ".patch");

// A unified diff, read just enough to check its shape: [{path, isNew, hunks: n}]; throws when a hunk's counts don't match its lines.
function parseDiff(text) {
  const lines = text.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  const files = [];
  let cur = null, i = 0;
  while (i < lines.length) {
    const l = lines[i];
    let m;
    if ((m = /^diff --git a\/(\S+) b\/(\S+)$/.exec(l))) {
      assert.strictEqual(m[1], m[2], `a rename in ${l}`);
      cur = { path: m[2], isNew: false, hunks: 0, minus: null, plus: null };
      files.push(cur); i++;
    } else if (cur && /^new file mode /.test(l)) { cur.isNew = true; i++; }
    else if (cur && /^(index |similarity |old mode |new mode )/.test(l)) i++;
    else if (cur && /^--- /.test(l)) { cur.minus = l.slice(4); i++; }
    else if (cur && /^\+\+\+ /.test(l)) { cur.plus = l.slice(4); i++; }
    else if (cur && (m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(l))) {
      let oldLeft = m[2] === undefined ? 1 : +m[2], newLeft = m[4] === undefined ? 1 : +m[4];
      i++;
      while ((oldLeft > 0 || newLeft > 0) && i < lines.length) {
        const c = lines[i][0];
        if (c === " " || lines[i] === "") { oldLeft--; newLeft--; }
        else if (c === "-") oldLeft--;
        else if (c === "+") newLeft--;
        else if (c === "\\") { /* "\ No newline at end of file" */ }
        else throw new Error(`unexpected line in a hunk of ${cur.path}: ${lines[i]}`);
        i++;
      }
      while (i < lines.length && lines[i][0] === "\\") i++;
      assert.ok(oldLeft === 0 && newLeft === 0, `hunk counts of ${cur.path} don't match its lines (${oldLeft}, ${newLeft})`);
      cur.hunks++;
    } else throw new Error(`unexpected line ${i + 1}: ${l}`);
  }
  return files;
}

// rebrand.patch_workbench on a stand-in app folder (VS Code's code shapes from test/rebrand-projects.test.js, one of each): → its
// printed lines and the workbench file afterwards.
const EMPTY = 'var GP=class extends Base{constructor(e){super(e);this.x=1}static{this.ID="workbench.explorer.emptyView"}static{this.NAME=O(17793,"No Folder Opened")}shouldShowWelcome(){return!0}};' +
  'var XTo={explorer:"workbench.explorer.emptyView",debug:"workbench.debug.welcome",scm:"workbench.scm",testing:"workbench.view.testing"};' +
  'var Dfe=reg;Dfe.registerViewWelcomeContent(GP.ID,{content:d(1,null),group:"2_open"});Dfe.registerViewWelcomeContent(GP.ID,{content:d(2,null)});Gt(1);\n';
const DEFAULT = 'class Layout{init(){if(this.isVisible("workbench.parts.sidebar")){let a=this.storageService.get(rP.activeViewletSettingsKey,1,this.viewDescriptorService.getDefaultViewContainer(0)?.id);' +
  'a?this.state.initialization.views.containerToRestore.sideBar=a:this.stateModel.setRuntimeValue(Jo.SIDEBAR_HIDDEN,!0)}}}' +
  'class Ext{registerCustomViewContainer(o,e,t,i,n,r){let a=this.viewContainersRegistry.get(o);return a||(a=this.viewContainersRegistry.registerViewContainer({id:o,order:i},r)),a}}\n';
const ALWAYS = 'class Reg{constructor(){this._views=new Map}addViews(e,t){let i=this._views.get(t);i||(i=[],this._views.set(t,i));for(let n of e)i.push(n)}}' +
  'class Bar{unpin(e){this.model.setPinned(e,!1)&&(this.resetActiveComposite(e))}resetActiveComposite(){}isPinned(){return!0}' +
  'move(e,t,i){if(i!==void 0){let n=this.model.items.findIndex(a=>a.id===e),r=this.model.items.findIndex(a=>a.id===t);n>=0&&r>=0&&(this.moves.push([e,t]))}}' +
  'getAction(i){return{label:i}}getPinnedCompositeIds(){return[1,2]}' +
  'getContextMenuActions(e){let t=this.model.visibleItems.map(({id:i,name:n,activityAction:r})=>{let a=this.isPinned(i);return{id:i,checked:a}});return t}}' +
  'class Item{showContextMenu(){let t=[];this.compositeBarActionItem.keybindingId&&t.push("keys"),t.push(this.toggleCompositePinnedAction,this.toggleCompositeBadgeAction);let i=[];return t}}' +
  'class Views{canMoveViews(){return!0}moveViewContainerToLocation(e,t,i,n){this.canMoveViews()&&(this.moved.push(e.id+">"+t))}}\n';
const CARD = 'var $e=new class{constructor(){this._commands=new Map,this._onDidRegisterCommand=new A}};Gt(izn,[[]],!0));export{For as main};/*! @license */\n//# sourceMappingURL=x.map\n';
const STAND_IN = EMPTY + DEFAULT + ALWAYS + CARD;
// What each rebrand function leaves in the file (its marker; the empty view's patch has one only on its first registration).
const MARKS = {
  "0200-drop-explorer-empty-view": "/*kural-explorer-empty*/",
  "0201-projects-default-view": "/*kural-projects-default*/",
  "0202-projects-always-shown": "/*kural-projects-fixed*/",
  "0203-in-window-card": "/*kural-card*/",
};
const FUNCTIONS = {
  "0200-drop-explorer-empty-view": "drop_explorer_empty_view", "0201-projects-default-view": "projects_default_view",
  "0202-projects-always-shown": "projects_always_shown", "0203-in-window-card": "add_in_window_card",
};

function runPatchWorkbench(kuralSource) {
  const app = fs.mkdtempSync(path.join(os.tmpdir(), "kural-patch-projects-"));
  try {
    const rel = "vs/workbench/workbench.desktop.main.js", js = path.join(app, "out", ...rel.split("/"));
    fs.mkdirSync(path.dirname(js), { recursive: true });
    fs.writeFileSync(js, STAND_IN);
    const product = { checksums: {} };
    if (kuralSource !== undefined) product.kuralSource = kuralSource;
    fs.writeFileSync(path.join(app, "product.json"), JSON.stringify(product));
    const code = `import sys\nsys.path.insert(0, ${JSON.stringify(path.join(root, "scripts"))})\nimport rebrand, json, os\n` +
      `app = ${JSON.stringify(app)}\np = os.path.join(app, "product.json")\nd = rebrand.load(p)\n` +
      `d["checksums"][${JSON.stringify(rel)}] = rebrand.fingerprint(open(${JSON.stringify(js)}, "rb").read())\nrebrand.save(p, d)\nrebrand.patch_workbench(app)\n`;
    const r = spawnSync("python3", ["-I", "-c", code], { encoding: "utf8", maxBuffer: 1 << 26 });
    assert.strictEqual(r.status, 0, r.stderr);
    const built = r.stdout.split("\n").filter((l) => /built in \(/.test(l));
    return { built, text: fs.readFileSync(js, "utf8"), stdout: r.stdout };
  } finally { fs.rmSync(app, { recursive: true, force: true }); }
}
const marked = (text) => NAMES.filter((n) => text.includes(MARKS[n]));

(async () => {
  console.log("the patch files:");
  for (const n of NAMES) {
    await check(`${n}.patch exists and is a unified diff that touches only src/vs/`, () => {
      assert.ok(fs.existsSync(file(n)), "missing");
      const text = fs.readFileSync(file(n), "utf8");
      const files = parseDiff(text);
      assert.ok(files.length > 0, "no files");
      for (const f of files) {
        assert.ok(f.path.startsWith("src/vs/") && !f.path.includes(".."), `touches ${f.path}`);
        assert.ok(f.hunks > 0, `${f.path} has no hunks`);
        assert.strictEqual(f.plus, "b/" + f.path, `${f.path}: +++ line`);
        assert.strictEqual(f.minus, f.isNew ? "/dev/null" : "a/" + f.path, `${f.path}: --- line`);
      }
      assert.ok(!/\p{Extended_Pictographic}/u.test(text), "an emoji in the patch");
    });
  }
  await check("the numbers keep the plan's ranges (0200-0299 Projects ports)", () => {
    for (const n of NAMES) assert.ok(/^02\d\d-/.test(n));
    assert.deepStrictEqual(fs.readdirSync(dir).filter((f) => /^02/.test(f)).sort(), NAMES.map((n) => n + ".patch").sort());
  });
  await check("the Projects bar's ids in the patches are the extension's (container, view)", () => {
    const all = NAMES.map((n) => fs.readFileSync(file(n), "utf8")).join("\n");
    assert.ok(all.includes("'workbench.view.extension.kural-projects'") && all.includes("'kural.projects'"));
    assert.ok(all.includes("_kural.card") && all.includes("_kural.cardClear"));
  });

  console.log("against VS Code's source:");
  const src = process.env.KURAL_VSCODE_SRC;
  if (!src || !fs.existsSync(path.join(src, ".git"))) {
    console.log("skip  git apply --check (set KURAL_VSCODE_SRC to a pristine checkout of VS Code at the commit in vscode.lock)");
  } else {
    const git = (args, input) => spawnSync("git", ["-C", src, ...args], { encoding: "utf8", input });
    await check("the checkout is pristine", () => {
      const st = git(["status", "--porcelain", "--", "src"]);
      assert.strictEqual(st.status, 0, st.stderr);
      assert.strictEqual(st.stdout.trim(), "", "KURAL_VSCODE_SRC has changes in src/: use a clean checkout:\n" + st.stdout);
    });
    for (const n of NAMES) {
      await check(`${n} applies alone`, () => {
        const r = git(["apply", "--check", file(n)]);
        assert.strictEqual(r.status, 0, r.stderr);
      });
    }
    await check("all four apply together, in order", () => {
      const r = git(["apply", "--check"], NAMES.map((n) => fs.readFileSync(file(n), "utf8")).join(""));
      assert.strictEqual(r.status, 0, r.stderr);
    });
  }

  console.log("rebrand.py and product.json kuralSource:");
  await check("without kuralSource all four run (as before)", () => {
    const r = runPatchWorkbench(undefined);
    assert.deepStrictEqual(r.built, []);
    assert.deepStrictEqual(marked(r.text), NAMES);
  });
  await check("with all four listed, none run and each says it is built in", () => {
    const r = runPatchWorkbench({ commit: "07f806f9", patches: NAMES });
    assert.strictEqual(r.built.length, 4, r.stdout);
    for (const n of NAMES) assert.ok(r.built.some((l) => l.includes(FUNCTIONS[n]) && l.includes(n)), `no line for ${n}:\n${r.stdout}`);
    assert.deepStrictEqual(marked(r.text), []);
    assert.strictEqual(r.text, STAND_IN, "the workbench file changed");
  });
  await check("only the listed ones are skipped (two of four, either way round)", () => {
    for (const listed of [[NAMES[0], NAMES[3]], [NAMES[1], NAMES[2]]]) {
      const r = runPatchWorkbench({ commit: "07f806f9", patches: listed });
      assert.strictEqual(r.built.length, 2, r.stdout);
      assert.deepStrictEqual(marked(r.text), NAMES.filter((n) => !listed.includes(n)));
    }
  });
  await check("a list with other patches in it (and names that aren't ours) skips nothing more", () => {
    const r = runPatchWorkbench({ commit: "07f806f9", patches: ["0100-one-frame-windows", NAMES[2], "nonsense", 7, null] });
    assert.strictEqual(r.built.length, 1, r.stdout);
    assert.deepStrictEqual(marked(r.text), [NAMES[0], NAMES[1], NAMES[3]]);
  });
  await check("kuralSource without a patches list (or of another shape) skips nothing", () => {
    for (const ks of [{ commit: "07f806f9" }, { patches: "0200-drop-explorer-empty-view" }, { patches: {} }, [], "yes", null]) {
      const r = runPatchWorkbench(ks);
      assert.deepStrictEqual(r.built, [], JSON.stringify(ks));
      assert.deepStrictEqual(marked(r.text), NAMES, JSON.stringify(ks));
    }
  });
  await check("an empty list skips nothing", () => {
    const r = runPatchWorkbench({ commit: "07f806f9", patches: [] });
    assert.deepStrictEqual(r.built, []);
    assert.deepStrictEqual(marked(r.text), NAMES);
  });

  console.log(fail ? `patch-projects-source: ${fail} FAILED` : "patch-projects-source: ALL PASS");
  process.exit(fail ? 1 : 0);
})();

// Projects and the Explorer in one side bar container (lib/projects/layout.js), on a stand-in for vscode.commands, and the
// two workbench rules that go with it: the Projects view can be collapsed and reordered (patch 0202 / rebrand.py) but not hidden.
const assert = require("assert");
const fs = require("fs"), path = require("path");
const { arrangeViews, CONTAINER, EXPLORER_VIEWS, QUIET_VIEWS, MERGED_KEY, MOVED_KEY, QUIET_KEY } = require("../extension/lib/projects/layout");

let failed = 0;
const check = async (name, fn) => { try { await fn(); console.log("ok  ", name); } catch (e) { failed++; console.error("FAIL", name, e.stack); } };
const fakeCommands = (list, { fail = [] } = {}) => {
  const ran = [];
  return { ran, getCommands: async () => list, executeCommand: async (id, arg) => { ran.push([id, arg]); if (arg && fail.includes(arg.viewIds[0])) throw new Error("no such view"); } };
};
const fakeState = (init = {}) => { const m = new Map(Object.entries(init)); return { m, get: (k) => m.get(k), update: async (k, v) => { m.set(k, v); } }; };
const moved = (c) => c.ran.filter((r) => r[0] === "vscode.moveViews").map((r) => r[1].viewIds[0]);

(async () => {
  const ALL = ["vscode.moveViews", "outline.removeView", "timeline.removeView"];
  const runs = (c, id) => c.ran.filter((r) => r[0] === id);
  await check("first start: Projects, then every Explorer view (NPM Scripts too: the Explorer's icon goes), remembered; Outline and Timeline hidden once", async () => {
    const c = fakeCommands(ALL), state = fakeState();
    const r = await arrangeViews({ commands: c, state });
    assert.deepStrictEqual(moved(c), ["kural.projects", ...EXPLORER_VIEWS]);
    assert.ok(EXPLORER_VIEWS.includes("npm") && EXPLORER_VIEWS[0] === "workbench.explorer.fileView");
    assert.ok(c.ran.filter((x) => x[0] === "vscode.moveViews").every((x) => x[1].destinationId === CONTAINER && x[1].viewIds.length === 1));
    assert.strictEqual(CONTAINER, "workbench.view.extension.kural-projects");
    assert.deepStrictEqual(state.get(MOVED_KEY), EXPLORER_VIEWS);
    assert.deepStrictEqual(r.hidden, QUIET_VIEWS);
    assert.deepStrictEqual(c.ran.filter((x) => x[0] !== "vscode.moveViews").map((x) => x[0]), ["outline.removeView", "timeline.removeView"]);
    assert.deepStrictEqual(state.get(QUIET_KEY), QUIET_VIEWS);
  });

  await check("later starts: only the Projects view is put back; nothing is hidden again (you may have shown Outline since)", async () => {
    const c = fakeCommands(ALL);
    await arrangeViews({ commands: c, state: fakeState({ [MOVED_KEY]: EXPLORER_VIEWS, [QUIET_KEY]: QUIET_VIEWS }) });
    assert.deepStrictEqual(moved(c), ["kural.projects"]);
  });

  await check("merged by the older version (four views): NPM Scripts moves now; Outline and Timeline are hidden once", async () => {
    const c = fakeCommands(ALL), state = fakeState({ [MERGED_KEY]: true });
    await arrangeViews({ commands: c, state });
    assert.deepStrictEqual(moved(c), ["kural.projects", "npm"]);
    assert.deepStrictEqual(state.get(MOVED_KEY), EXPLORER_VIEWS);
    assert.strictEqual(runs(c, "outline.removeView").length, 1);
  });

  await check("no vscode.moveViews: nothing runs, nothing is remembered, a note is logged", async () => {
    const c = fakeCommands(["_kural.oneFrame"]), state = fakeState(), notes = [];
    const r = await arrangeViews({ commands: c, state, log: (m) => notes.push(m) });
    assert.deepStrictEqual(c.ran, []); assert.strictEqual(state.m.size, 0); assert.strictEqual(r.missing, true); assert.ok(notes.length === 1);
  });

  await check("a view that can't be moved doesn't stop the others and is tried again next start; it isn't hidden", async () => {
    const c = fakeCommands(ALL, { fail: ["outline"] }), state = fakeState();
    await arrangeViews({ commands: c, state });
    assert.strictEqual(moved(c).length, 1 + EXPLORER_VIEWS.length, "all were tried");
    assert.ok(!state.get(MOVED_KEY).includes("outline"));
    assert.deepStrictEqual(runs(c, "outline.removeView"), []);
    const c2 = fakeCommands(ALL);
    await arrangeViews({ commands: c2, state });
    assert.deepStrictEqual(moved(c2), ["kural.projects", "outline"]);
  });

  await check("0202 and rebrand.py: the Projects view can't be hidden but can be moved (reordered with the Explorer)", () => {
    const patch = fs.readFileSync(path.join(__dirname, "../patches/kural/0202-projects-always-shown.patch"), "utf8");
    assert.ok(/canToggleVisibility: item\.id !== 'kural\.projects'/.test(patch));
    assert.ok(/\+\s+canMoveView: viewContainer\?\.id !== REMOTE,/.test(patch) && !/canMoveView:[^\n]*kural\.projects/.test(patch));
    const py = fs.readFileSync(path.join(__dirname, "../scripts/rebrand.py"), "utf8");
    assert.ok(py.includes("_kv.canToggleVisibility=!1;") && !py.includes("_kv.canMoveView=!1"));
  });
  // (Seen in the built app, 27 Oct 2026: the second project's window had the Explorer above Projects. The Projects view's
  // order was 1, its place in Kural's list + 1, like the file view's: VS Code breaks such a tie by which view was added
  // first, and after the first start the moved Explorer views are placed before any extension's view registers.)
  await check("0202 and rebrand.py: the Projects view sorts above the Explorer's views (order -1), whichever registered first", () => {
    const patch = fs.readFileSync(path.join(__dirname, "../patches/kural/0202-projects-always-shown.patch"), "utf8");
    assert.ok(/\+\s+order: item\.id === 'kural\.projects' \? -1 : order,/.test(patch), "the source patch");
    assert.ok(/-\s+order: order,/.test(patch), "(in place of VS Code's own line)");
    const py = fs.readFileSync(path.join(__dirname, "../scripts/rebrand.py"), "utf8");
    assert.ok(py.includes("_kv.order=-1"), "VSCodium's build (rebrand.py)");
  });

  await check("0100: a window that never reports its first paint is shown after 5 s (and the hunk's line counts still match)", () => {
    const patch = fs.readFileSync(path.join(__dirname, "../patches/kural/0100-one-frame-windows.patch"), "utf8");
    assert.ok(patch.includes("await Promise.race([this.whenPainted, timeout(5000)]);"));
    const lines = patch.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const m = /^@@ -\d+,?(\d*) \+\d+,?(\d*) @@/.exec(lines[i]);
      if (!m) continue;
      let a = Number(m[1] || 1), b = Number(m[2] || 1), o = 0, n = 0;
      for (i++; i < lines.length && (o < a || n < b); i++) { const l = lines[i]; if (l[0] === "+") n++; else if (l[0] === "-") o++; else if (l[0] !== "\\") { o++; n++; } }
      i--; assert.deepStrictEqual([o, n], [a, b], "hunk ending at line " + i);
    }
  });

  console.log(failed ? `\n${failed} failed` : "\nall ok");
  process.exit(failed ? 1 : 0);
})();

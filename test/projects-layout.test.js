// Projects and the Explorer in one side bar container (lib/projects/layout.js), on a stand-in for vscode.commands, and the
// two workbench rules that go with it: the Projects view can be collapsed and reordered (patch 0202 / rebrand.py) but not hidden.
const assert = require("assert");
const fs = require("fs"), path = require("path");
const { arrangeViews, CONTAINER, EXPLORER_VIEWS, MERGED_KEY } = require("../extension/lib/projects/layout");

let failed = 0;
const check = async (name, fn) => { try { await fn(); console.log("ok  ", name); } catch (e) { failed++; console.error("FAIL", name, e.stack); } };
const fakeCommands = (list, { fail = [] } = {}) => {
  const ran = [];
  return { ran, getCommands: async () => list, executeCommand: async (id, arg) => { ran.push([id, arg]); if (fail.includes(arg && arg.viewIds[0])) throw new Error("no such view"); } };
};
const fakeState = (init = {}) => { const m = new Map(Object.entries(init)); return { m, get: (k) => m.get(k), update: async (k, v) => { m.set(k, v); } }; };
const moved = (c) => c.ran.map((r) => r[1].viewIds[0]);

(async () => {
  await check("first start: Projects, then the Explorer's views, all into the Projects container; remembered", async () => {
    const c = fakeCommands(["vscode.moveViews"]), state = fakeState();
    const r = await arrangeViews({ commands: c, state });
    assert.deepStrictEqual(moved(c), ["kural.projects", ...EXPLORER_VIEWS]);
    assert.ok(c.ran.every((x) => x[0] === "vscode.moveViews" && x[1].destinationId === CONTAINER && x[1].viewIds.length === 1));
    assert.strictEqual(CONTAINER, "workbench.view.extension.kural-projects");
    assert.ok(EXPLORER_VIEWS[0] === "workbench.explorer.fileView");
    assert.strictEqual(state.get(MERGED_KEY), true);
    assert.strictEqual(r.moved.length, 1 + EXPLORER_VIEWS.length);
  });

  await check("later starts: only the Projects view is put back; the Explorer views stay where you left them", async () => {
    const c = fakeCommands(["vscode.moveViews"]);
    await arrangeViews({ commands: c, state: fakeState({ [MERGED_KEY]: true }) });
    assert.deepStrictEqual(moved(c), ["kural.projects"]);
  });

  await check("no vscode.moveViews: nothing runs, nothing is remembered, a note is logged", async () => {
    const c = fakeCommands(["_kural.oneFrame"]), state = fakeState(), notes = [];
    const r = await arrangeViews({ commands: c, state, log: (m) => notes.push(m) });
    assert.deepStrictEqual(c.ran, []); assert.strictEqual(state.m.size, 0); assert.strictEqual(r.missing, true); assert.ok(notes.length === 1);
  });

  await check("a view that can't be moved doesn't stop the others; not remembered when the Explorer's own view failed", async () => {
    const c = fakeCommands(["vscode.moveViews"], { fail: ["outline"] }), state = fakeState();
    await arrangeViews({ commands: c, state });
    assert.strictEqual(moved(c).length, 1 + EXPLORER_VIEWS.length, "all were tried");
    assert.strictEqual(state.get(MERGED_KEY), true);
    const c2 = fakeCommands(["vscode.moveViews"], { fail: ["workbench.explorer.fileView"] }), s2 = fakeState();
    await arrangeViews({ commands: c2, state: s2 });
    assert.strictEqual(s2.m.size, 0, "tried again next start");
  });

  await check("0202 and rebrand.py: the Projects view can't be hidden but can be moved (reordered with the Explorer)", () => {
    const patch = fs.readFileSync(path.join(__dirname, "../patches/kural/0202-projects-always-shown.patch"), "utf8");
    assert.ok(/canToggleVisibility: item\.id !== 'kural\.projects'/.test(patch));
    assert.ok(/\+\s+canMoveView: viewContainer\?\.id !== REMOTE,/.test(patch) && !/canMoveView:[^\n]*kural\.projects/.test(patch));
    const py = fs.readFileSync(path.join(__dirname, "../scripts/rebrand.py"), "utf8");
    assert.ok(py.includes("_kv.canToggleVisibility=!1}}") && !py.includes("_kv.canMoveView=!1"));
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

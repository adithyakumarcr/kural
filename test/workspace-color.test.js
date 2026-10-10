// Workspace Color (lib/workspace-color.js): the pure parts (hex, contrast, merge/remove of colorCustomizations) and the
// command with a stand-in for vscode (no folder; pick; custom; remove; cancel puts the old settings back).
const assert = require("assert");
const Module = require("module");

let fail = 0;
const check = async (name, fn) => { try { await fn(); console.log("ok  ", name); } catch (e) { fail++; console.log("FAIL", name, e.message); } };

// ---- vscode stand-in: workspace values kept per "section.key", writes recorded ----
const store = {};
const writes = [], messages = [];
let folders = [{}], qp, inputText, themeKind = 2;
const vscode = {
  ConfigurationTarget: { Workspace: 2 }, QuickPickItemKind: { Separator: -1 },
  workspace: {
    get workspaceFolders() { return folders; }, workspaceFile: undefined,
    getConfiguration: (section) => ({
      inspect: (key) => ({ workspaceValue: store[`${section}.${key}`] }),
      update: async (key, value, target) => {
        assert.strictEqual(target, 2); writes.push([`${section}.${key}`, value]);
        if (value === undefined) delete store[`${section}.${key}`]; else store[`${section}.${key}`] = JSON.parse(JSON.stringify(value));
      },
    }),
  },
  window: {
    get activeColorTheme() { return { kind: themeKind }; },
    showInformationMessage: (m) => { messages.push(m); }, showWarningMessage: (m) => { messages.push(m); },
    showInputBox: async (o) => { assert.ok(o.validateInput("zzz") && !o.validateInput("#28d")); return inputText; },
    createQuickPick: () => {
      qp = { handlers: {}, dispose() {}, hide() { this.handlers.hide && this.handlers.hide(); }, show() {},
        onDidChangeActive(f) { this.handlers.active = f; }, onDidAccept(f) { this.handlers.accept = f; }, onDidHide(f) { this.handlers.hide = f; } };
      return qp;
    },
  },
  commands: { registerCommand: (id, fn) => ({ id, fn }) },
};
const load = Module._load;
Module._load = function (r, ...a) { return r === "vscode" ? vscode : load.call(this, r, ...a); };
const wc = require("../extension/lib/workspace-color");

const tick = () => new Promise((r) => setTimeout(r, 0));
// opens the picker, lets `act` do something with it, resolves when the command is done
async function drive(act) {
  const p = wc.ask();
  await tick();
  await act(qp);
  await p;
}
const pick = (q, finder) => { q.selectedItems = [q.items.find(finder)]; q.handlers.accept(); };

(async () => {
  await check("normalizeHex accepts #rgb and #rrggbb, any case, and nothing else", () => {
    assert.strictEqual(wc.normalizeHex("#28D"), "#2288dd");
    assert.strictEqual(wc.normalizeHex(" 2F6FDB "), "#2f6fdb");
    for (const bad of ["", "#12", "#12345", "#1234567", "blue", "#ggg", null]) assert.strictEqual(wc.normalizeHex(bad), null, String(bad));
  });
  await check("foreground: white on dark colors, near-black on light ones; every listed color reads (>= 4.5:1)", () => {
    assert.strictEqual(wc.foregroundFor("#000000"), "#ffffff");
    assert.strictEqual(wc.foregroundFor("#ffffff"), "#1e1e1e");
    assert.strictEqual(wc.foregroundFor("#f1c40f"), "#1e1e1e");
    assert.strictEqual(wc.foregroundFor("#4b3fb5"), "#ffffff");
    for (const palette of [wc.DARK, wc.LIGHT]) for (const c of palette) assert.ok(wc.contrast(c.hex, wc.foregroundFor(c.hex)) >= 4.5, c.name);
  });
  await check("DARK and LIGHT have the same 11 names; DARK is deep (HSL lightness < 35 %), LIGHT is pastel (> 75 %)", () => {
    const names = (p) => p.map((c) => c.name);
    assert.deepStrictEqual(names(wc.DARK), names(wc.LIGHT));
    assert.strictEqual(wc.DARK.length, 11);
    const lightness = (hex) => { const n = parseInt(hex.slice(1), 16); const v = [(n >> 16) & 255, (n >> 8) & 255, n & 255]; return (Math.max(...v) + Math.min(...v)) / 2 / 255; };
    for (const c of wc.DARK) assert.ok(lightness(c.hex) < 0.35, `DARK ${c.name} ${c.hex}`);
    for (const c of wc.LIGHT) assert.ok(lightness(c.hex) > 0.75, `LIGHT ${c.name} ${c.hex}`);
  });
  await check("the picker shows LIGHT for light themes (kind 1, high contrast light 4), DARK otherwise", async () => {
    const shown = async (kind) => {
      themeKind = kind; let hexes = [];
      await drive(async (q) => { hexes = q.items.filter((i) => i.hex).map((i) => i.hex); q.handlers.hide(); });
      return hexes;
    };
    assert.deepStrictEqual(await shown(1), wc.LIGHT.map((c) => c.hex));
    assert.deepStrictEqual(await shown(4), wc.LIGHT.map((c) => c.hex));
    assert.deepStrictEqual(await shown(2), wc.DARK.map((c) => c.hex));
    assert.deepStrictEqual(await shown(3), wc.DARK.map((c) => c.hex));
    themeKind = 2;
  });
  await check("colorsFor sets exactly the six keys; inactive is the foreground at 60 % opacity", () => {
    const c = wc.colorsFor("#2e476b");
    assert.deepStrictEqual(Object.keys(c).sort(), [...wc.KEYS].sort());
    assert.strictEqual(c["activityBar.background"], "#2e476b");
    assert.strictEqual(c["activityBar.inactiveForeground"], c["activityBar.foreground"] + "99");
    assert.strictEqual(c["activityBarBadge.foreground"], "#2e476b");
  });
  await check("merge keeps other keys and replaces ours; remove drops only our unchanged keys", () => {
    const mine = wc.mergeColors({ "editor.background": "#000", "activityBar.background": "#111" }, "#2e476b");
    assert.strictEqual(mine["editor.background"], "#000");
    assert.strictEqual(mine["activityBar.background"], "#2e476b");
    const left = wc.removeColors({ ...mine, "activityBar.activeBorder": "#ff0000" }, "#2e476b");   // the border was changed by hand
    assert.deepStrictEqual(left, { "editor.background": "#000", "activityBar.activeBorder": "#ff0000" });
    assert.strictEqual(wc.removeColors(wc.mergeColors(undefined, "#2e476b"), "#2e476b"), null);
    assert.deepStrictEqual(wc.removeColors({ "activityBar.background": "#123456" }, undefined), { "activityBar.background": "#123456" });
    assert.deepStrictEqual(wc.mergeColors("nonsense", "#2e476b"), wc.colorsFor("#2e476b"));
  });

  await check("no folder open: says so and writes nothing", async () => {
    folders = [];
    await wc.ask();
    assert.ok(/Open a folder/.test(messages[0])); assert.strictEqual(writes.length, 0);
    folders = [{}];
  });
  await check("a pick is saved with the color remembered; other customizations stay; items use icons, no emoji", async () => {
    store["workbench.colorCustomizations"] = { "editor.background": "#101010" };
    await drive(async (q) => { q.handlers.active([q.items[0]]); q.handlers.active([q.items.find((i) => /Blue/.test(i.label))]); await tick(); pick(q, (i) => /Blue/.test(i.label)); });
    const c = store["workbench.colorCustomizations"];
    assert.strictEqual(c["editor.background"], "#101010"); assert.strictEqual(c["activityBar.background"], "#2e476b");
    assert.strictEqual(store["kural.workspaceColor"], "#2e476b");
    assert.ok(qp.items.every((i) => i.kind === -1 || /^\$\([a-z-]+\) /.test(i.label)));
    assert.ok(!qp.items.some((i) => /\p{Extended_Pictographic}/u.test(i.label)));
  });
  await check("moving through the list previews; cancel puts the old settings back", async () => {
    const writesAtOpen = writes.length;
    const before = JSON.parse(JSON.stringify(store["workbench.colorCustomizations"]));
    await drive(async (q) => {
      q.handlers.active([q.items[0]]); await tick();   // (the list opening: its first item, not a preview)
      assert.deepStrictEqual(writes.length, writesAtOpen, "opening writes nothing");
      q.handlers.active([q.items.find((i) => /Red/.test(i.label))]); await tick(); await tick();
      assert.strictEqual(store["workbench.colorCustomizations"]["activityBar.background"], "#642b2b", "previewed");
      q.handlers.hide();
    });
    assert.deepStrictEqual(store["workbench.colorCustomizations"], before);
    assert.strictEqual(store["kural.workspaceColor"], "#2e476b");
  });
  await check("opening the list and pressing Esc writes nothing", async () => {
    const n = writes.length;
    await drive(async (q) => { q.handlers.active([q.items[0]]); await tick(); q.handlers.hide(); });
    assert.strictEqual(writes.length, n);
  });
  await check("custom hex: normalized and saved; cancelling the input changes nothing", async () => {
    inputText = "#e91";
    await drive(async (q) => pick(q, (i) => i.custom));
    assert.strictEqual(store["kural.workspaceColor"], "#ee9911");
    assert.strictEqual(store["workbench.colorCustomizations"]["activityBar.background"], "#ee9911");
    inputText = undefined;
    await drive(async (q) => pick(q, (i) => i.custom));
    assert.strictEqual(store["kural.workspaceColor"], "#ee9911");
  });
  await check("remove: only Kural's keys go, the rest stays; with nothing left the setting goes too", async () => {
    await drive(async (q) => pick(q, (i) => i.remove));
    assert.deepStrictEqual(store["workbench.colorCustomizations"], { "editor.background": "#101010" });
    assert.strictEqual(store["kural.workspaceColor"], undefined);
    delete store["workbench.colorCustomizations"];
    await drive(async (q) => pick(q, (i) => /Green/.test(i.label)));
    await drive(async (q) => pick(q, (i) => i.remove));
    assert.ok(!("workbench.colorCustomizations" in store) && !("kural.workspaceColor" in store));
  });
  await check("a user's own activity bar colors are not removed when Kural never set one", async () => {
    store["workbench.colorCustomizations"] = { "activityBar.background": "#123456" };
    await drive(async (q) => pick(q, (i) => i.remove));
    assert.deepStrictEqual(store["workbench.colorCustomizations"], { "activityBar.background": "#123456" });
  });

  Module._load = load;
  process.exit(fail ? 1 : 0);
})();

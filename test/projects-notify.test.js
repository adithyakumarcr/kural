// The Notifier's "card" route (lib/chat/notify.js): a card in another Kural window that's in front goes first on every system;
// when it isn't shown there (false, a throw, no such part) the old order applies; the setting still decides first.
const assert = require("assert");
const { Notifier, notifyDecision } = require("../extension/lib/chat/notify");

let failed = 0;
const check = async (name, fn) => { try { await fn(); console.log("ok  ", name); } catch (e) { failed++; console.error("FAIL", name, e.stack); } };

// A Notifier whose every way records itself in `calls`.
function make(platform, elsewhere, extra = {}) {
  const calls = [], logs = [];
  const parts = { hasToast: async () => true, toast: async () => { calls.push("toast"); return { clicked: false, supported: true }; }, clearToast: async () => {},
    run: async (c) => { calls.push("os"); return true; }, inApp: async () => { calls.push("app"); return false; }, log: (t) => logs.push(t), platform, ...extra };
  if (elsewhere) parts.elsewhere = elsewhere;
  const n = new Notifier(parts); n.toastWaitMs = 20;
  return { n, calls, logs };
}
const msg = { id: "kural-chat-t1", title: "Fix is done", body: "Fixed.", attention: false, tabId: "t1" };

(async () => {
  for (const platform of ["darwin", "linux", "win32"]) {
    await check(`${platform}: a card shown in another window is the only route used`, async () => {
      const asked = [];
      const { n, calls, logs } = make(platform, async (o) => { asked.push(o); return true; });
      assert.strictEqual(await n.show(msg), "card");
      assert.deepStrictEqual(asked, [{ id: "kural-chat-t1", title: "Fix is done", body: "Fixed.", attention: false, tabId: "t1" }]);
      assert.deepStrictEqual(calls, []);
      assert.ok(logs.includes("notify: shown as a card in another Kural window"));
    });
  }
  await check("the card route is tried first", () => {
    assert.deepStrictEqual(make("darwin", async () => false).n.routes(), ["card", "os", "toast", "app"]);
    assert.deepStrictEqual(make("linux", async () => false).n.routes(), ["card", "toast", "os", "app"]);
  });
  await check("not shown there (false) or it threw: the old order, a Mac with osascript first, Linux with the toast first", async () => {
    for (const elsewhere of [async () => false, async () => undefined, async () => { throw new Error("no other window"); }, () => { throw new Error("sync"); }]) {
      let t = make("darwin", elsewhere);
      assert.strictEqual(await t.n.show(msg), "os"); assert.deepStrictEqual(t.calls, ["os"]);
      t = make("linux", elsewhere);
      assert.strictEqual(await t.n.show(msg), "toast"); assert.deepStrictEqual(t.calls, ["toast"]);
    }
    const t = make("linux", async () => { throw new Error("no other window"); });
    await t.n.show(msg);
    assert.ok(t.logs.some((l) => /card in another window failed: no other window/.test(l)));
  });
  await check("not shown there, nothing else works: the window's own message at the end", async () => {
    const t = make("linux", async () => false, { hasToast: async () => false, run: async () => { t.calls.push("os"); return false; } });
    assert.strictEqual(await t.n.show(msg), "app");
    assert.deepStrictEqual(t.calls, ["os", "app"]);
  });
  await check("no elsewhere part: unchanged", async () => {
    assert.deepStrictEqual(make("darwin").n.routes(), ["os", "toast", "app"]);
    assert.deepStrictEqual(make("linux").n.routes(), ["toast", "os", "app"]);
    const t = make("linux");
    assert.strictEqual(await t.n.show(msg), "toast"); assert.deepStrictEqual(t.calls, ["toast"]);
  });
  await check("the setting still decides first: off sends nothing, so no card either", () => {
    assert.strictEqual(notifyDecision("off", { focused: false, onScreen: false }).send, false);
    assert.strictEqual(notifyDecision("whenAway", { focused: false, onScreen: true }).send, true);
  });

  console.log(failed ? `projects-notify: ${failed} FAILED` : "projects-notify: ALL PASS");
  process.exit(failed ? 1 : 0);
})();

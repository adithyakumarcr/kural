// Auto mode, a big task: Kural offers more agents above the box; no answer within the wait = one agent
// (lib/chat/index.js offerTeam). The wait is shortened for the test.
process.env.KURAL_TEAM_OFFER_SECONDS = "0.2";
const assert = require("assert"), Module = require("module");
const load = Module._load;
const vscode = { workspace: { isTrusted: true, workspaceFolders: [], textDocuments: [], getConfiguration: () => ({ get: (k, d) => d }) },
  ConfigurationTarget: { Global: 1 }, env: { appRoot: "/unused" }, commands: { executeCommand: () => {} }, Uri: { file: (fsPath) => ({ scheme: "file", fsPath }) } };
const proxy = new Proxy(vscode, { get: (o, k) => o[k] || new Proxy(function () {}, { get: () => () => {} }) });
Module._load = function (r, ...args) { return r === "vscode" ? proxy : load.call(this, r, ...args); };
const { ChatView } = require("../extension/lib/chat");
const brain = require("../extension/lib/ai");
brain.providerOf = () => ({ ready: () => true });
const BIG = "Build a full user authentication system with login, signup, password reset, email verification, and an admin dashboard, plus tests";
let failed = 0;
const check = async (name, fn) => { try { await fn(); console.log("ok  ", name); } catch (e) { failed++; console.error("FAIL", name, e.stack); } };
function chat(tab) {
  const c = Object.create(ChatView.prototype), posted = [];
  Object.assign(c, { tabs: [tab], routingJobs: new Map(), teamOffers: new Map(), post: (m) => posted.push(m), postTabs: () => {},
    remember: () => {}, save: () => {}, warm: () => {} });
  return { c, posted };
}
const tabOf = (o = {}) => ({ id: "t", mode: "auto", team: 0, model: "sonnet", status: "idle", messages: [], ...o });

(async () => {
  await check("multiple agents are switched off: a big task in Auto is never offered a team, and no tab has one", async () => {
    const tab = tabOf(), { c, posted } = chat(tab);
    assert.strictEqual(await c.offerTeam(tab, BIG), null); assert.strictEqual(posted.length, 0);
    assert.strictEqual(c.teamSize(tabOf({ team: 3, mode: "agent" })), 0);
    c.tab = (id) => c.tabs.find((x) => x.id === id);
    await c.handle({ type: "setTeam", tabId: "t", team: 3 }, null);
    assert.strictEqual(tab.team, 0);
  });
  console.log(failed ? `team-offer: ${failed} FAILED` : "team-offer: ALL PASS");
  process.exitCode = failed ? 1 : 0;
})();

// Building an agreed plan is well-defined work: Auto hands it to a light model (Haiku); the team's developers start on
// Haiku too (lib/router/policy.js wellDefined, lib/chat/team.js).
const assert = require("assert");
const { select } = require("../extension/lib/router/policy");
const { projectPrompt, teamMembers, teamPrompt } = require("../extension/lib/chat/team");
let failed = 0;
const check = (name, fn) => { try { fn(); console.log("ok  ", name); } catch (e) { failed++; console.error("FAIL", name, e.stack); } };
const claude = (id, label) => ({ id, label, providerId: "claude", provider: "Claude", ready: true, team: true, commands: true });
const models = [claude("opus", "Opus"), claude("sonnet", "Sonnet"), claude("haiku", "Haiku")];
const plan = "Go ahead and implement the plan above.";
check("Build it: Haiku in Balance and Cost; your model in Intelligence", () => {
  for (const profile of ["balance", "cost"]) {
    const c = select(models, { prompt: plan, current: "sonnet", profile, wellDefined: true, mode: "agent", editing: true }, { profile });
    assert.strictEqual(c.model, "haiku", profile); assert.match(c.reason, /well-defined task/);
  }
  const i = select(models, { prompt: plan, current: "opus", profile: "intelligence", wellDefined: true }, { profile: "intelligence" });
  assert.notStrictEqual(i.model, "haiku");
  // The same words without a plan behind them aren't well-defined.
  const big = "Refactor the whole payments module into separate services and migrate the database schema";
  assert.notStrictEqual(select(models, { prompt: big, current: "sonnet", profile: "balance" }, { profile: "balance" }).model, "haiku");
});
check("a failing step still escalates past Haiku", () => {
  const c = select(models, { prompt: plan, current: "haiku", profile: "balance", wellDefined: true, checkpoint: true }, { profile: "balance" });
  assert.notStrictEqual(c.model, "haiku");
});
check("team prompts: developers start on Haiku; the tester keeps the lead's model", () => {
  const p = projectPrompt(teamMembers(0, ["developer", "tester"], "split"));
  assert.match(p, /Start each developer with model "haiku"/); assert.match(p, /Phoebe keeps your model/);
  assert.match(teamPrompt(3, [], "split"), /model "haiku"/);
});
console.log(failed ? `haiku-build: ${failed} FAILED` : "haiku-build: ALL PASS"); process.exitCode = failed ? 1 : 0;

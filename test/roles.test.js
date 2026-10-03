// Agent team roles and the instructions Kural gives the lead (extension/lib/chat.js teamPrompt).
const assert = require("assert");
const Module = require("module");
const load = Module._load;
Module._load = function (r, ...a) { return r === "vscode" ? new Proxy({}, { get: () => new Proxy(function () {}, { get: () => () => {} }) }) : load.call(this, r, ...a); };
const { _test: { teamPrompt, ROLES } } = require("../extension/lib/chat.js");

let fail = 0;
const check = (name, fn) => { try { fn(); console.log("ok  ", name); } catch (e) { fail++; console.log("FAIL", name, e.message); } };
const order = (p, ...words) => { let at = -1; for (const w of words) { const i = p.indexOf(w, at + 1); assert.ok(i > at, `"${w}" missing or out of order`); at = i; } };

check("the roles: Researcher, Architect, Developer, Tester (each with its own name)", () => {
  assert.deepStrictEqual(ROLES.map((r) => `${r.name} ${r.label}`), ["Rachel Researcher", "Ross Architect", "Monica Developer", "Phoebe Tester"]);
});

check("full project team: the lead is the PM; plan → user's OK → build → check → report", () => {
  const p = teamPrompt(0, ["researcher", "architect", "developer", "tester"], "split");
  assert.ok(/You are the Project Manager \(PM\)/.test(p));
  order(p, "1. Requirements", "AskUserQuestion", "2. Plan. Start Rachel and Ross", "3. Your plan, the user's OK", '"Go ahead"', "4. Build", "5. Report");
  assert.ok(/up to 3 Developers \(Monica, Chandler, Joey; you decide how many\)/.test(p));
  assert.ok(/You are Rachel, the Researcher/.test(p) && /You are Ross, the Architect/.test(p));
  assert.ok(/You are Joey, the Developer/.test(p) && /You are Phoebe, the Tester/.test(p));
  assert.ok(/Rachel researches and posts a plan proposal to Ross/.test(p));
  assert.ok(/Phoebe replies "OK"/.test(p));
});

check("Researcher + Developer: the Researcher's plan, your OK, then build (no tester)", () => {
  const p = teamPrompt(0, ["researcher", "developer"], "split");
  order(p, "2. Plan. Start Rachel", "Rachel researches and posts the plan", "3. Your plan, the user's OK", "4. Build", "5. Report");
  assert.ok(!/Phoebe|Ross/.test(p));
});

check("Researcher + Architect: a plan only, nobody builds, no approval needed", () => {
  const p = teamPrompt(0, ["researcher", "architect"], "split");
  order(p, "2. Plan", "3. Result. The plan is the result", "4. Report");
  assert.ok(!/Go ahead|Build\./.test(p));
});

check("Developer + Tester: the PM plans, asks for your OK, then build and check", () => {
  const p = teamPrompt(0, ["developer", "tester"], "split");
  order(p, "1. Requirements", "2. Your plan, the user's OK", "Plan the work yourself", "3. Build", "4. Report");
});

check("Discuss & decide uses the same roles (one Developer)", () => {
  const p = teamPrompt(0, ["architect", "developer"], "discuss");
  assert.ok(/discussion between 2 agents: Ross, the Architect.*Monica, the Developer/.test(p));
  assert.ok(!/Chandler|Joey/.test(p));
  assert.ok(/Ross then posts to "all": "DECISION/.test(p));
});

check("Discuss with one role gets a second agent", () => {
  const p = teamPrompt(0, ["tester"], "discuss");
  assert.ok(/discussion between 2 agents: Phoebe, the Tester.*; Rachel/.test(p), p.slice(0, 200));
});

check("no roles: as before (parallel agents)", () => {
  assert.ok(/You lead a team of 3 agents: Rachel; Ross; Monica/.test(teamPrompt(3, [], "split")));
});

console.log(fail ? `roles: ${fail} FAILED` : "roles: ALL PASS");
process.exit(fail ? 1 : 0);

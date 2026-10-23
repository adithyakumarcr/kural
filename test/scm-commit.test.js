// Source Control's commit message: short (issue #104: about 200 characters), whatever the model replies.
const assert = require("assert");
const Module = require("module");
const load = Module._load;
Module._load = function (req, ...a) { return req === "vscode" ? {} : load.call(this, req, ...a); };   // no editor needed
const { concise, tidy, SYSTEM_PROMPT, MAX_CHARS } = require("../extension/lib/scm/commit");

let fail = 0;
const check = (name, fn) => { try { fn(); console.log("ok  ", name); } catch (e) { fail++; console.log("FAIL", name, e.message); } };

check("the prompt asks for the limit", () => assert.ok(SYSTEM_PROMPT.includes(`at most ${MAX_CHARS} characters`)));
check("a short message stays as it is", () => {
  const m = "fix(chat): keep the ticket search open\n\nOnly Claude's reports change the connector state.";
  assert.strictEqual(concise(m), m);
});
check("a long body is cut at a whole line, the subject stays", () => {
  const body = Array.from({ length: 12 }, (_, i) => `- change number ${i} in some file of the project`).join("\n");
  const out = concise(`feat(theme): stronger light theme contrast\n\n${body}`);
  assert.ok(out.length <= MAX_CHARS, out.length);
  assert.ok(out.startsWith("feat(theme): stronger light theme contrast\n\n- change number 0"));
  assert.ok(out.split("\n").every((l) => body.includes(l) || l === "" || l.startsWith("feat")), "no line cut in half");
});
check("a subject that's too long alone is cut at a word", () => {
  const out = concise("fix: " + "word ".repeat(60));
  assert.ok(out.length <= MAX_CHARS && !out.endsWith(" ") && out.endsWith("word"));
});
check("empty stays empty", () => assert.strictEqual(concise(tidy("")), ""));
check("tags and quotes are removed first", () => assert.strictEqual(concise(tidy('<msg>"docs: fix a typo"</msg>')), "docs: fix a typo"));

console.log(fail ? `scm-commit: ${fail} FAILED` : "scm-commit: ALL PASS");
process.exit(fail ? 1 : 0);

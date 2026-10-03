// Tab in the terminal: the model's answer → one full command line that continues what you typed.
const assert = require("assert");
const Module = require("module");
const load = Module._load;
Module._load = function (req, ...a) { return req === "vscode" ? {} : load.call(this, req, ...a); };   // no editor needed
const { tidy, _test: { plainWords, tidyIntent } } = require("../extension/lib/tab/terminal");

let fail = 0;
const check = (name, fn) => { try { fn(); console.log("ok  ", name); } catch (e) { fail++; console.log("FAIL", name, e.message); } };
const typed = 'git commit -m "';

check("Claude's <cmd> answer", () => assert.strictEqual(tidy('<cmd>git commit -m "Add low_stock() and its test"</cmd>', typed), 'git commit -m "Add low_stock() and its test"'));
check("only the first line", () => assert.strictEqual(tidy('<cmd>git add -A\ngit commit</cmd>', "git a"), "git add -A"));
check("a forgotten closing quote is added", () => assert.strictEqual(tidy('<cmd>git commit -m "params: require positive speed</cmd>', typed), 'git commit -m "params: require positive speed"'));
check("closed quotes stay as they are", () => assert.strictEqual(tidy('<cmd>echo "a \\"b\\" c"</cmd>', "echo"), 'echo "a \\"b\\" c"'));
check("a leading $ is dropped", () => assert.strictEqual(tidy("<cmd>$ ls -la</cmd>", "ls"), "ls -la"));
check("local model: just the rest of the line", () => assert.strictEqual(tidy(typed + 'Fix negative quantities in remove()"', typed), 'git commit -m "Fix negative quantities in remove()"'));
check("the local model's end marker is dropped", () => assert.strictEqual(tidy(typed + 'Add restock()"<|endoftext|>', typed), 'git commit -m "Add restock()"'));
check("nothing new: no suggestion", () => { assert.strictEqual(tidy("<cmd></cmd>", typed), ""); assert.strictEqual(tidy(`<cmd>${typed}</cmd>`, typed), ""); });
check("must continue what you typed", () => assert.strictEqual(tidy("<cmd>rm -rf build</cmd>", "git st"), ""));
// Plain words → a command (the chat's model). Which lines count as plain words:
check("plain words are noticed", () => {
  for (const t of ["Push this code to fix/code-editor branch", "commit with message please fix the login", "delete all the build folders",
    "show me what changed today", "git push this to the main branch"]) assert.ok(plainWords(t), t);
});
check("commands stay commands", () => {
  for (const t of ["git push origin main", 'git commit -m "fix it"', "ls -la", "npm run build -- --watch", "cd src/app", "python3 main.py --port 80",
    "grep -rn foo .", "echo hello > out.txt", "ga", "make"]) assert.ok(!plainWords(t), t);
});
check("the model's command, one line, quote closed", () => {
  assert.strictEqual(tidyIntent("<cmd>git push origin fix/code-editor</cmd>"), "git push origin fix/code-editor");
  assert.strictEqual(tidyIntent('Sure! <cmd>git commit -m "Please fix the login</cmd>'), 'git commit -m "Please fix the login"');
  assert.strictEqual(tidyIntent("<cmd></cmd>"), "");
  assert.strictEqual(tidyIntent("<cmd>git add -A\ngit commit</cmd>"), "git add -A");
  assert.strictEqual(tidyIntent(`<cmd>git commit -am "$(cat <<'EOF'\nPlease add the speed check\n\nCo-Authored-By: X <x@y>\nEOF\n)"</cmd>`), 'git commit -am "Please add the speed check"');
});
console.log(fail ? `terminal tab: ${fail} FAILED` : "terminal tab: ALL PASS");
process.exit(fail ? 1 : 0);

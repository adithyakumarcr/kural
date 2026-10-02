// Tab in the terminal: the model's answer → one full command line that continues what you typed.
const assert = require("assert");
const Module = require("module");
const load = Module._load;
Module._load = function (req, ...a) { return req === "vscode" ? {} : load.call(this, req, ...a); };   // no editor needed
const { tidy } = require("../extension/lib/terminal-tab");

let fail = 0;
const check = (name, fn) => { try { fn(); console.log("ok  ", name); } catch (e) { fail++; console.log("FAIL", name, e.message); } };
const typed = 'git commit -m "';

check("Claude's <cmd> answer", () => assert.strictEqual(tidy('<cmd>git commit -m "Add low_stock() and its test"</cmd>', typed), 'git commit -m "Add low_stock() and its test"'));
check("only the first line", () => assert.strictEqual(tidy('<cmd>git add -A\ngit commit</cmd>', "git a"), "git add -A"));
check("a leading $ is dropped", () => assert.strictEqual(tidy("<cmd>$ ls -la</cmd>", "ls"), "ls -la"));
check("local model: just the rest of the line", () => assert.strictEqual(tidy(typed + 'Fix negative quantities in remove()"', typed), 'git commit -m "Fix negative quantities in remove()"'));
check("the local model's end marker is dropped", () => assert.strictEqual(tidy(typed + 'Add restock()"<|endoftext|>', typed), 'git commit -m "Add restock()"'));
check("nothing new: no suggestion", () => { assert.strictEqual(tidy("<cmd></cmd>", typed), ""); assert.strictEqual(tidy(`<cmd>${typed}</cmd>`, typed), ""); });
check("must continue what you typed", () => assert.strictEqual(tidy("<cmd>rm -rf build</cmd>", "git st"), ""));
console.log(fail ? `terminal tab: ${fail} FAILED` : "terminal tab: ALL PASS");
process.exit(fail ? 1 : 0);

// Ctrl+K / Apply: the code is taken out of <code>…</code> with its indentation intact.
const assert = require("assert");
const { unwrap } = require("../extension/lib/code-reply");

const cases = [
  ["keeps the first line's indentation", "<code>\n    def f():\n        return 1\n</code>", "    def f():\n        return 1"],
  ["ignores text around the tags", "Here you go:\n<code>\n  x = 1\n</code>\nDone.", "  x = 1"],
  ["code that itself contains </code>", "<code>\n<p><code>a</code></p>\n</code>", "<p><code>a</code></p>"],
  ["tag on the same line as code", "<code>    x = 1</code>", "    x = 1"],
  ["Windows line breaks", "<code>\r\n\tif a:\r\n\t\tb()\r\n</code>", "\tif a:\r\n\t\tb()"],
  ["old habit: markdown fence", "```python\n    y = 2\n```", "    y = 2"],
  ["plain reply", "    z = 3", "    z = 3"],
  ["empty region", "<code>\n</code>", ""],
];
let fail = 0;
for (const [name, input, want] of cases) {
  try { assert.strictEqual(unwrap(input), want); console.log("ok  ", name); }
  catch { fail++; console.log("FAIL", name, JSON.stringify(unwrap(input))); }
}
console.log(fail ? `edits: ${fail} FAILED` : "edits: ALL PASS");
process.exit(fail ? 1 : 0);

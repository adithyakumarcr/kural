// npm test: runs every test/*.test.js (none need Claude), one after another. A new test file is picked up by
// itself, so adding one never means editing package.json (parallel branches used to clash on that one line).
const { spawnSync } = require("child_process");
const fs = require("fs"), path = require("path");

const files = fs.readdirSync(__dirname).filter((f) => f.endsWith(".test.js")).sort();
const failed = [];
for (const f of files) {
  const r = spawnSync(process.execPath, [path.join(__dirname, f)], { stdio: "inherit" });
  if (r.status !== 0) failed.push(f);
}
console.log(failed.length ? `\nFAILED: ${failed.join(", ")}` : `\nAll ${files.length} test files passed.`);
process.exit(failed.length ? 1 : 0);

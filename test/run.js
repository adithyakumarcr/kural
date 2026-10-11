// npm test: runs every test/*.test.js (none need Claude), one after another. A new test file is picked up by
// itself, so adding one never means editing package.json (parallel branches used to clash on that one line).
// On GitHub Actions a failing file also becomes an error annotation with its FAIL lines, so the reason shows on the
// pull request without opening the whole log.
const { spawnSync } = require("child_process");
const fs = require("fs"), path = require("path");

const files = fs.readdirSync(__dirname).filter((f) => f.endsWith(".test.js")).sort();
const failed = [];
const ci = !!process.env.GITHUB_ACTIONS;
for (const f of files) {
  const r = spawnSync(process.execPath, [path.join(__dirname, f)], ci ? { encoding: "utf8", maxBuffer: 64 << 20 } : { stdio: "inherit" });
  if (ci) { process.stdout.write(r.stdout || ""); process.stderr.write(r.stderr || ""); }
  if (r.status !== 0) {
    failed.push(f);
    if (ci) {
      const out = `${r.stdout || ""}\n${r.stderr || ""}`.split("\n");
      const i = out.findIndex((l) => /^FAIL\b|Error/.test(l));
      const why = (i >= 0 ? out.slice(i, i + 6) : out.filter(Boolean).slice(-6)).join("\n").slice(0, 1500);
      const esc = (s) => s.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
      console.log(`::error title=${esc(f)} failed::${esc(why || `exit ${r.status}${r.signal ? ` (${r.signal})` : ""}`)}`);
    }
  }
}
console.log(failed.length ? `\nFAILED: ${failed.join(", ")}` : `\nAll ${files.length} test files passed.`);
process.exit(failed.length ? 1 : 0);

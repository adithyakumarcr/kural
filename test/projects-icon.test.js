// The Projects bar's activity bar icon (Adithya, 25 Oct 2026: the same icon as the design mockup): Codicons'
// folder-library glyph as media/projects-icon.svg, made by scripts/make-projects-icon.js. Checks: the committed file is
// exactly what the script makes, it's one filled path in the font's em box, and package.json's Projects container uses it.
const assert = require("assert");
const fs = require("fs"), path = require("path");
const { make, OUT } = require("../scripts/make-projects-icon");

let fail = 0;
const check = (name, fn) => { try { fn(); console.log("ok  ", name); } catch (e) { fail++; console.log("FAIL", name, e.message); } };
const root = path.join(__dirname, "..");
const svg = fs.readFileSync(OUT, "utf8");

check("the committed icon is what scripts/make-projects-icon.js makes (run it after changing the script)", () => {
  assert.strictEqual(make(), svg, "projects-icon.svg is out of date: node scripts/make-projects-icon.js");
});

check("one filled path in a square view box, colored by the theme (currentColor)", () => {
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 (\d+) \1" fill="currentColor">/);
  assert.strictEqual((svg.match(/<path /g) || []).length, 1);
  assert.match(svg, /d="M[\d. ]+[LQ]/);
});

check("package.json's Projects container uses it", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "extension", "package.json"), "utf8"));
  const box = pkg.contributes.viewsContainers.activitybar.find((c) => c.id === "kural-projects");
  assert.strictEqual(box.icon, "media/projects-icon.svg");
});

if (fail) { console.log(`${fail} failed`); process.exit(1); }

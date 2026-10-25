#!/usr/bin/env node
// make-projects-icon.js: writes extension/media/projects-icon.svg, the Projects bar's icon in the activity bar, from
// Codicons' "folder-library" glyph (the icon the status bar's "projects need a look" item and the design mockup use).
// The glyph is derived from Codicons (CC BY 4.0, media/codicons/LICENSE-icons). Run: node scripts/make-projects-icon.js
const fs = require("fs");
const path = require("path");
const { readFont } = require("./make-status-icons");

const ROOT = path.join(__dirname, "..");
const FOLDER_LIBRARY = 0xebdf;   // .codicon-folder-library (codicon.css)
const OUT = path.join(ROOT, "extension", "media", "projects-icon.svg");

// A TrueType contour (quadratic, on/off-curve points) as an SVG path; y flipped into the em box.
function contourPath(points, em) {
  const p = points.map(([x, y, on]) => ({ x, y: em - y, on }));
  const n = p.length;
  const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, on: true });
  let start = p.findIndex((q) => q.on);
  let first = start < 0 ? mid(p[0], p[1]) : p[start];
  if (start < 0) start = 0;
  const f = (v) => +v.toFixed(2);
  let d = `M${f(first.x)} ${f(first.y)}`;
  for (let i = 1; i <= n; i++) {
    const cur = p[(start + i) % n];
    if (cur.on) { d += `L${f(cur.x)} ${f(cur.y)}`; continue; }
    const next = p[(start + i + 1) % n];
    const end = next.on ? next : mid(cur, next);
    d += `Q${f(cur.x)} ${f(cur.y)} ${f(end.x)} ${f(end.y)}`;
    if (next.on) i++;
  }
  return d + "Z";
}

function make() {
  const font = readFont(fs.readFileSync(path.join(ROOT, "extension", "media", "codicons", "codicon.ttf")));
  const em = font.unitsPerEm;
  const d = font.contours(font.glyphOf(FOLDER_LIBRARY)).map((c) => contourPath(c, em)).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${em} ${em}" fill="currentColor">` +
    `<path fill-rule="nonzero" d="${d}"/></svg>\n`;
}

if (require.main === module) {
  fs.writeFileSync(OUT, make());
  console.log(`wrote ${path.relative(ROOT, OUT)}`);
}
module.exports = { make, OUT };

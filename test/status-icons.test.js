// Kural's status bar icons (Adithya: just icons there; Tab Completion's sparkle crossed out while it's off).
// The crossed-out sparkle isn't in Codicons, so Kural has its own little font: media/codicons/kural-icons.ttf, made by
// scripts/make-status-icons.js from Codicons' sparkle. Checks: the committed font is exactly what the script makes, it's a
// well-formed TrueType font (tables, checksums, the character), the glyph is the sparkle with a slash and a gap, and
// package.json and the status items use it.
const assert = require("assert");
const fs = require("fs"), path = require("path");
const { make, readFont, TAB_OFF, OUT } = require("../scripts/make-status-icons");

let fail = 0;
const check = (name, fn) => { try { fn(); console.log("ok  ", name); } catch (e) { fail++; console.log("FAIL", name, e.message); } };
const root = path.join(__dirname, "..");
const font = fs.readFileSync(OUT);

check("the committed font is what scripts/make-status-icons.js makes (run it after changing the script)", () => {
  assert.ok(Buffer.compare(make(), font) === 0, "kural-icons.ttf is out of date: node scripts/make-status-icons.js");
});

check("a well-formed TrueType font: the tables browsers require, their checksums, the whole file's", () => {
  const sum = (b) => { let s = 0; for (let i = 0; i < b.length; i += 4) s = (s + (b.length - i >= 4 ? b.readUInt32BE(i) : Buffer.concat([b.subarray(i), Buffer.alloc(4)]).readUInt32BE(0))) >>> 0; return s; };
  assert.strictEqual(font.readUInt32BE(0), 0x00010000);
  const tags = [];
  for (let i = 0; i < font.readUInt16BE(4); i++) {
    const o = 12 + i * 16, tag = font.toString("latin1", o, o + 4), off = font.readUInt32BE(o + 8), len = font.readUInt32BE(o + 12);
    tags.push(tag);
    assert.strictEqual(off % 4, 0, tag);
    const t = Buffer.from(font.subarray(off, off + len));
    if (tag === "head") t.writeUInt32BE(0, 8);
    assert.strictEqual(sum(t), font.readUInt32BE(o + 4), `${tag} checksum`);
  }
  assert.deepStrictEqual(tags, ["OS/2", "cmap", "glyf", "head", "hhea", "hmtx", "loca", "maxp", "name", "post"]);
  assert.strictEqual(sum(font), 0xb1b0afba);   // (the head table's checkSumAdjustment makes it so)
});

const f = readFont(font), codicons = readFont(fs.readFileSync(path.join(root, "extension", "media", "codicons", "codicon.ttf")));
check("U+E001 is the icon; the same size and metrics as Codicons, so it lines up with the other icons", () => {
  assert.strictEqual(f.glyphOf(TAB_OFF), 1);
  assert.strictEqual(f.unitsPerEm, codicons.unitsPerEm);
  assert.strictEqual(f.advance(1), codicons.advance(codicons.glyphOf(0xec10)));
  for (const at of [4, 6, 8]) assert.strictEqual(f.t("hhea").readInt16BE(at), codicons.t("hhea").readInt16BE(at));   // ascender, descender, line gap
});

check("the glyph: the sparkle on both sides of a slash from top left to bottom right, a gap on the upper right", () => {
  const em = f.unitsPerEm, px = em / 16, pts = f.contours(1).flat();
  assert.ok(pts.every((p) => p[0] >= 0 && p[0] <= em && p[1] >= 0 && p[1] <= em));
  // Upper right of the slash's middle line x + y = em: a point is either on the slash (half a pixel) or a pixel more away.
  const off = pts.map((p) => (p[0] + p[1] - em) / Math.SQRT2).filter((d) => d > 0);
  assert.ok(off.every((d) => d <= px / 2 + 1 || d >= 1.5 * px - 1), "a point inside the gap");
  // The slash reaches near both corners; the sparkle is there on both sides.
  assert.ok(pts.some((p) => p[0] < 2 * px && p[1] > em - 2 * px) && pts.some((p) => p[0] > em - 2 * px && p[1] < 2 * px));
  assert.ok(pts.some((p) => p[0] + p[1] < em - 3 * px) && pts.some((p) => p[0] + p[1] > em + 3 * px));
  assert.ok(f.contours(1).length > 4);
});

check("package.json declares $(kural-tab-off) with this font and character", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "extension", "package.json"), "utf8"));
  const icon = pkg.contributes.icons["kural-tab-off"];
  assert.strictEqual(path.resolve(root, "extension", icon.default.fontPath), OUT);
  assert.strictEqual(icon.default.fontCharacter, "\\E001");
  assert.ok(icon.description);
});

check("the status bar: Tab Completion is an icon (the sparkle, crossed out when off); problems keep their words", () => {
  const src = fs.readFileSync(path.join(root, "extension", "extension.js"), "utf8");
  assert.ok(/ready: +\["\$\(sparkle\)",/.test(src) && /\["\$\(kural-tab-off\)", tabCard\(false\)/.test(src));
  assert.ok(!/"\$\(sparkle\) Tab Completion"/.test(src) && !/circle-slash\) Tab Completion/.test(src));
  assert.ok(/"\$\(warning\) Tab Completion"/.test(src) && /"\$\(rocket\) Kural: finish setup"/.test(src));
  assert.ok(/accessibilityInformation: \{ label, role: "button" \}/.test(src));
});

console.log(fail ? `status-icons: ${fail} FAILED` : "status-icons: ALL PASS");
process.exit(fail ? 1 : 0);

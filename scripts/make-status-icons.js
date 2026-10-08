#!/usr/bin/env node
// Makes extension/media/codicons/kural-icons.ttf: Kural's own status bar icons, for what the Codicons font doesn't have.
//   U+E001  kural-tab-off   Codicons' "sparkle" (Tab Completion's icon) crossed out: a slash from top left to bottom
//                           right, drawn like Codicons' own "off" icons (bell-slash, mic-off): joined to the shape on
//                           one side, a gap on the other.
// package.json "contributes.icons" declares it, so the status bar shows it as $(kural-tab-off).
// Reproducible: no dependencies, no dates; the same Codicons font gives the same bytes (test/status-icons.test.js checks
// that the committed font is what this script makes). Run: node scripts/make-status-icons.js [out.ttf]
// The glyph is derived from Codicons (CC BY 4.0, media/codicons/LICENSE-icons).
const fs = require("fs"), path = require("path");

const ROOT = path.join(__dirname, "..");
const CODICONS = path.join(ROOT, "extension", "media", "codicons", "codicon.ttf");
const OUT = path.join(ROOT, "extension", "media", "codicons", "kural-icons.ttf");
const SPARKLE = 0xec10;            // .codicon-sparkle (codicon.css)
const TAB_OFF = 0xe001;

// ---------- reading a TrueType font ----------
function readFont(buf) {
  const tables = {};
  for (let i = 0; i < buf.readUInt16BE(4); i++) {
    const o = 12 + i * 16;
    tables[buf.toString("latin1", o, o + 4)] = { off: buf.readUInt32BE(o + 8), len: buf.readUInt32BE(o + 12) };
  }
  const t = (tag) => buf.subarray(tables[tag].off, tables[tag].off + tables[tag].len);
  const head = t("head"), longLoca = head.readInt16BE(50) === 1, loca = t("loca"), glyf = t("glyf"), cmap = t("cmap");
  const glyphOf = (cp) => {
    for (let i = 0; i < cmap.readUInt16BE(2); i++) {
      const s = cmap.subarray(cmap.readUInt32BE(8 + i * 8));
      if (s.readUInt16BE(0) === 4) {
        const n2 = s.readUInt16BE(6), ends = 14, starts = ends + n2 + 2, deltas = starts + n2, ranges = deltas + n2;
        for (let k = 0; k < n2 / 2; k++) {
          const start = s.readUInt16BE(starts + k * 2);
          if (cp < start || cp > s.readUInt16BE(ends + k * 2)) continue;
          const delta = s.readInt16BE(deltas + k * 2), ro = s.readUInt16BE(ranges + k * 2);
          if (!ro) return (cp + delta) & 0xffff;
          const g = s.readUInt16BE(ranges + k * 2 + ro + (cp - start) * 2);
          return g ? (g + delta) & 0xffff : 0;
        }
      }
      if (s.readUInt16BE(0) === 12) {
        for (let k = 0; k < s.readUInt32BE(12); k++) {
          const st = s.readUInt32BE(16 + k * 12), en = s.readUInt32BE(20 + k * 12);
          if (cp >= st && cp <= en) return s.readUInt32BE(24 + k * 12) + cp - st;
        }
      }
    }
    throw new Error(`U+${cp.toString(16)} isn't in the font`);
  };
  // A glyph's contours: [[x, y, onCurve], ...] per contour.
  const contours = (gid) => {
    const a = longLoca ? loca.readUInt32BE(gid * 4) : loca.readUInt16BE(gid * 2) * 2;
    let p = a;
    const n = glyf.readInt16BE(p);
    if (n < 0) throw new Error("a composite glyph");
    p += 10;
    const ends = [];
    for (let i = 0; i < n; i++, p += 2) ends.push(glyf.readUInt16BE(p));
    p += 2 + glyf.readUInt16BE(p);
    const count = ends[n - 1] + 1, flags = [];
    while (flags.length < count) { const f = glyf[p++]; flags.push(f); if (f & 8) for (let r = glyf[p++]; r > 0; r--) flags.push(f); }
    const coords = (short, same) => {
      let v = 0;
      return flags.map((f) => {
        if (f & short) { const d = glyf[p++]; v += f & same ? d : -d; } else if (!(f & same)) { v += glyf.readInt16BE(p); p += 2; }
        return v;
      });
    };
    const xs = coords(2, 16), ys = coords(4, 32), out = [];
    let s = 0;
    for (const e of ends) { const c = []; for (let i = s; i <= e; i++) c.push([xs[i], ys[i], flags[i] & 1]); out.push(c); s = e + 1; }
    return out;
  };
  const hhea = t("hhea"), hmtx = t("hmtx"), numH = hhea.readUInt16BE(34);
  const advance = (gid) => hmtx.readUInt16BE(Math.min(gid, numH - 1) * 4);
  return { tables, t, glyphOf, contours, advance, unitsPerEm: head.readUInt16BE(18) };
}

// ---------- shapes ----------
// A TrueType contour (quadratic curves; two off-curve points in a row have an on-curve point between them) as a polygon.
function flatten(contour, steps = 8) {
  const pts = [];
  const n = contour.length;
  const at = (i) => contour[(i + n) % n];
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 1];
  let start = contour.findIndex((q) => q[2]);
  const first = start >= 0 ? contour[start] : mid(contour[0], contour[1]);
  if (start < 0) start = 0;
  let prev = first;
  pts.push([first[0], first[1]]);
  for (let k = 1; k <= n; k++) {
    const cur = at(start + k);
    if (cur[2]) { pts.push([cur[0], cur[1]]); prev = cur; continue; }
    const next = at(start + k + 1), end = next[2] ? next : mid(cur, next);
    for (let s = 1; s <= steps; s++) {
      const u = s / steps, a = (1 - u) * (1 - u), b = 2 * u * (1 - u), c = u * u;
      pts.push([a * prev[0] + b * cur[0] + c * end[0], a * prev[1] + b * cur[1] + c * end[1]]);
    }
    if (next[2]) k++;
    prev = end;
  }
  pts.pop();   // (back where it started)
  return pts;
}

// The part of a polygon on one side of the line x + y = c (Sutherland-Hodgman; keep(p) says which side).
function clip(poly, c, below) {
  const inside = (p) => below ? p[0] + p[1] <= c : p[0] + p[1] >= c;
  const cross = (a, b) => { const t = (c - a[0] - a[1]) / (b[0] + b[1] - a[0] - a[1]); return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]; };
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    if (inside(b)) { if (!inside(a)) out.push(cross(a, b)); out.push(b); } else if (inside(a)) out.push(cross(a, b));
  }
  return out;
}

const area = (poly) => poly.reduce((s, p, i) => { const q = poly[(i + 1) % poly.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0) / 2;

// Whole units, no repeated points or points on a straight line between their neighbours.
function tidy(poly) {
  let pts = poly.map(([x, y]) => [Math.round(x), Math.round(y)]).filter((p, i, a) => i === 0 || p[0] !== a[i - 1][0] || p[1] !== a[i - 1][1]);
  while (pts.length > 1 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1]) pts.pop();
  let changed = true;
  while (changed && pts.length > 3) {
    changed = false;
    for (let i = 0; i < pts.length && pts.length > 3; i++) {
      const a = pts[(i - 1 + pts.length) % pts.length], b = pts[i], c = pts[(i + 1) % pts.length];
      if ((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) === 0) { pts.splice(i, 1); changed = true; i--; }
    }
  }
  return pts.length >= 3 && Math.abs(area(pts)) >= 1 ? pts : null;
}

// A bar from a to b, half as wide as `half`, with round ends; turning like `sign` (the font's filled contours).
function bar(a, b, half, sign) {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]), ux = (b[0] - a[0]) / len, uy = (b[1] - a[1]) / len;
  const pts = [], ang = Math.atan2(uy, ux);
  for (let k = 0; k <= 8; k++) { const t = ang - Math.PI / 2 + (Math.PI * k) / 8; pts.push([b[0] + half * Math.cos(t), b[1] + half * Math.sin(t)]); }
  for (let k = 0; k <= 8; k++) { const t = ang + Math.PI / 2 + (Math.PI * k) / 8; pts.push([a[0] + half * Math.cos(t), a[1] + half * Math.sin(t)]); }
  return Math.sign(area(pts)) === sign ? pts : pts.reverse();
}

// Codicons' "sparkle" crossed out. Codicons are drawn on a 16 px grid (unitsPerEm units); their slash (bell-slash) runs
// along x + y = em from near one corner to the other, 1 px wide; the shape touches it on the lower left and keeps a 1 px
// gap on the upper right (a gap on both sides cut too much of the thin sparkle away: it no longer looked like one).
function tabOff(font) {
  const em = font.unitsPerEm, px = em / 16;
  const shape = font.contours(font.glyphOf(SPARKLE)).map((c) => flatten(c));
  const sign = Math.sign(area(shape.reduce((big, p) => Math.abs(area(p)) > Math.abs(area(big)) ? p : big)));
  const half = px / 2, gap = px, r2 = Math.SQRT2;   // (x + y changes √2 times as fast as the distance from the slash)
  const parts = [];
  for (const poly of shape) for (const side of [[em + half * r2, true], [em + (half + gap) * r2, false]]) {
    const piece = tidy(clip(poly, side[0], side[1]));
    if (piece) parts.push(piece);
  }
  const reach = 1.5 * px;   // (the slash's ends, like bell-slash's: 1.5 px in from the corners)
  parts.push(tidy(bar([reach, em - reach], [em - reach, reach], half, sign)));
  return { contours: parts, advance: font.advance(font.glyphOf(SPARKLE)) };
}

// ---------- writing a TrueType font ----------
const u16 = (v) => { const b = Buffer.alloc(2); b.writeUInt16BE(v & 0xffff); return b; };
const i16 = (v) => { const b = Buffer.alloc(2); b.writeInt16BE(v); return b; };
const u32 = (v) => { const b = Buffer.alloc(4); b.writeUInt32BE(v >>> 0); return b; };
const pad4 = (b) => b.length % 4 ? Buffer.concat([b, Buffer.alloc(4 - (b.length % 4))]) : b;
const checksum = (b) => { let s = 0; const p = pad4(b); for (let i = 0; i < p.length; i += 4) s = (s + p.readUInt32BE(i)) >>> 0; return s; };

function glyphData(contours) {
  if (!contours.length) return Buffer.alloc(0);
  const all = contours.flat(), xs = all.map((p) => p[0]), ys = all.map((p) => p[1]);
  const parts = [i16(contours.length), i16(Math.min(...xs)), i16(Math.min(...ys)), i16(Math.max(...xs)), i16(Math.max(...ys))];
  let end = -1;
  for (const c of contours) { end += c.length; parts.push(u16(end)); }
  parts.push(u16(0));                                   // no instructions
  parts.push(Buffer.alloc(all.length, 1));              // every point on the curve, x and y as 16-bit steps
  let x = 0, y = 0;
  for (const p of all) { parts.push(i16(p[0] - x)); x = p[0]; }
  for (const p of all) { parts.push(i16(p[1] - y)); y = p[1]; }
  return Buffer.concat(parts);
}

function nameTable(names) {
  const records = [], strings = [];
  let off = 0;
  for (const [id, text] of Object.entries(names)) {
    const s = Buffer.from(text, "utf16le").swap16();
    records.push(Buffer.concat([u16(3), u16(1), u16(0x409), u16(Number(id)), u16(s.length), u16(off)]));
    strings.push(s); off += s.length;
  }
  return Buffer.concat([u16(0), u16(records.length), u16(6 + records.length * 12), ...records, ...strings]);
}

function build(font, glyphs) {
  // glyphs: [{ cp, contours, advance }]; glyph 0 is an empty .notdef.
  const all = [{ contours: [], advance: font.unitsPerEm }, ...glyphs];
  const data = all.map((g) => pad4(glyphData(g.contours)));
  const loca = [0];
  for (const d of data) loca.push(loca[loca.length - 1] + d.length);
  const bboxOf = (g) => { const p = g.contours.flat(); return p.length ? [Math.min(...p.map((q) => q[0])), Math.min(...p.map((q) => q[1])), Math.max(...p.map((q) => q[0])), Math.max(...p.map((q) => q[1]))] : [0, 0, 0, 0]; };
  const boxes = all.map(bboxOf).filter((b, i) => all[i].contours.length);
  const bbox = [Math.min(...boxes.map((b) => b[0])), Math.min(...boxes.map((b) => b[1])), Math.max(...boxes.map((b) => b[2])), Math.max(...boxes.map((b) => b[3]))];
  const src = (tag) => Buffer.from(font.t(tag));

  const head = src("head");
  head.writeUInt32BE(0x00010000, 4);       // fontRevision 1.0
  head.writeUInt32BE(0, 8);                // checkSumAdjustment: set at the end
  head.fill(0, 20, 36);                    // created, modified: none (the same bytes every time)
  bbox.forEach((v, i) => head.writeInt16BE(v, 36 + i * 2));
  head.writeInt16BE(1, 50);                // long loca offsets

  const hhea = src("hhea");
  hhea.writeUInt16BE(Math.max(...all.map((g) => g.advance)), 10);
  hhea.writeInt16BE(Math.min(...all.map((g) => (g.contours.length ? bboxOf(g)[0] : 0))), 12);
  hhea.writeInt16BE(Math.min(...all.map((g) => (g.contours.length ? g.advance - bboxOf(g)[2] : 0))), 14);
  hhea.writeInt16BE(Math.max(...all.map((g) => (g.contours.length ? bboxOf(g)[2] : 0))), 16);
  hhea.writeUInt16BE(all.length, 34);

  const maxp = Buffer.concat([u32(0x00010000), u16(all.length), u16(Math.max(...all.map((g) => g.contours.flat().length))),
    u16(Math.max(...all.map((g) => g.contours.length))), u16(0), u16(0), u16(2), u16(0), u16(0), u16(0), u16(0), u16(0), u16(0), u16(0), u16(0)]);

  const os2 = src("OS/2");
  os2.writeUInt16BE(Math.min(...glyphs.map((g) => g.cp)), 64);   // usFirstCharIndex
  os2.writeUInt16BE(Math.max(...glyphs.map((g) => g.cp)), 66);   // usLastCharIndex

  const hmtx = Buffer.concat(all.map((g) => Buffer.concat([u16(g.advance), i16(g.contours.length ? bboxOf(g)[0] : 0)])));

  // cmap: one format 4 subtable (each icon its own segment, then the closing 0xFFFF one), for Unicode and Windows.
  const segs = [...glyphs.map((g, i) => ({ start: g.cp, end: g.cp, delta: (i + 1 - g.cp) & 0xffff })), { start: 0xffff, end: 0xffff, delta: 1 }];
  const n = segs.length, range = 2 * 2 ** Math.floor(Math.log2(n));
  const sub = Buffer.concat([u16(4), u16(16 + 8 * n), u16(0), u16(2 * n), u16(range), u16(Math.log2(range / 2)), u16(2 * n - range),
    ...segs.map((s) => u16(s.end)), u16(0), ...segs.map((s) => u16(s.start)), ...segs.map((s) => u16(s.delta)), ...segs.map(() => u16(0))]);
  const cmap = Buffer.concat([u16(0), u16(2), u16(0), u16(3), u32(20), u16(3), u16(1), u32(20), sub]);

  const name = nameTable({ 0: "Kural's status bar icons, derived from Codicons by Microsoft (CC BY 4.0)", 1: "kural-icons", 2: "Regular",
    3: "kural-icons", 4: "kural-icons", 5: "Version 1.0", 6: "kural-icons" });
  const post = Buffer.concat([u32(0x00030000), Buffer.alloc(28)]);
  const tables = { "OS/2": os2, cmap, glyf: Buffer.concat(data), head, hhea, hmtx, loca: Buffer.concat(loca.map(u32)), maxp, name, post };

  const tags = Object.keys(tables).sort();
  const count = tags.length, sr = 16 * 2 ** Math.floor(Math.log2(count));
  let offset = 12 + 16 * count;
  const dir = [u32(0x00010000), u16(count), u16(sr), u16(Math.log2(sr / 16)), u16(count * 16 - sr)], body = [];
  for (const tag of tags) {
    const t = tables[tag];
    dir.push(Buffer.from(tag, "latin1"), u32(checksum(t)), u32(offset), u32(t.length));
    body.push(pad4(t)); offset += pad4(t).length;
  }
  const file = Buffer.concat([...dir, ...body]);
  const headAt = 12 + 16 * count + tags.slice(0, tags.indexOf("head")).reduce((s, tag) => s + pad4(tables[tag]).length, 0);
  file.writeUInt32BE((0xb1b0afba - checksum(file)) >>> 0, headAt + 8);
  return file;
}

function make() {
  const font = readFont(fs.readFileSync(CODICONS));
  return build(font, [{ cp: TAB_OFF, ...tabOff(font) }]);
}

if (require.main === module) {
  const out = process.argv[2] || OUT;
  fs.writeFileSync(out, make());
  console.log("written", path.relative(process.cwd(), out));
}

module.exports = { make, readFont, TAB_OFF, OUT };

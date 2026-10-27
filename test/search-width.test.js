// The Search tab and the Ask tab of "Search & Ask" (media/search.css) have their input box at the same left and right edge, with
// the same radius and padding (Adithya, 27 Oct 2026: Ask was wider). Search is the reference: .find has 2px on the left, the
// 16px twist and a 2px gap (= 20px), 10px on the right; Ask's .top has to start at the same place..
const assert = require("assert"), fs = require("fs"), path = require("path");
const css = fs.readFileSync(path.join(__dirname, "../extension/media/search.css"), "utf8");
const js = fs.readFileSync(path.join(__dirname, "../extension/media/search.js"), "utf8");
const rule = (sel) => { const m = css.match(new RegExp(`(?:^|\\n)${sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`)); assert.ok(m, `no rule for ${sel}`); return m[1]; };
const prop = (body, name) => { const m = body.match(new RegExp(`(?:^|[;\\s])${name}:\\s*([^;]+)`)); return m && m[1].trim(); };
const px = (v) => v.trim().split(/\s+/).map((x) => parseFloat(x));
let failed = 0;
const check = (name, fn) => { try { fn(); console.log("ok  ", name); } catch (e) { failed++; console.error("FAIL", name, e.stack); } };

check("Ask's box starts and ends where Search's box does", () => {
  const find = px(prop(rule(".find"), "padding")), gap = parseFloat(prop(rule(".find"), "gap")), twist = parseFloat(prop(rule(".twist"), "width"));
  const top = px(prop(rule(".top"), "padding"));
  assert.strictEqual(top[3], find[3] + twist + gap, "left edge");
  assert.strictEqual(top[1], find[1], "right edge");
});
check("Ask's box has the Search box's radius and padding; the send button is a small circle with room around it", () => {
  const box = rule(".box"), ask = rule(".top .box");
  assert.strictEqual(prop(ask, "border-radius"), prop(box, "border-radius"));
  assert.strictEqual(prop(ask, "padding"), prop(box, "padding"));
  // (Adithya, 27 Oct 2026: the 20 px circle filled the box's whole height. 16 px, a 10 px arrow, 2 px on each side.)
  const go = rule(".go");
  assert.match(prop(go, "width"), /calc\(16px/); assert.match(prop(go, "height"), /calc\(16px/);
  assert.strictEqual(prop(go, "border-radius"), "50%");
  assert.strictEqual(prop(go, "margin"), "0 2px");
  assert.match(css, /\.go \.codicon \{ font-size: calc\(10px/);
});
check("both tabs use the same box class and border-box sizing", () => {
  assert.match(css, /\* \{ box-sizing: border-box; \}/);
  assert.match(js, /el\("div", \{ class: "top" \}, el\("div", \{ class: "box" \}/);
  assert.ok(!/style=/.test(css), "the widths are CSS rules");
});
if (failed) process.exit(1);
console.log("\nall passed");

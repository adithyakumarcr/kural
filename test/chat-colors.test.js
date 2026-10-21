// Calm reading's colors (media/chat.css) mean something: blue = note, green = tip and passed, purple = important,
// amber = watch out, red = risk and failed. Each must stay readable (4.5:1) in Kural Dark and Kural Light, on the panel and
// on its own tinted callout (9% of the color over the panel). And the guide and the release notes tell people about it.
const assert = require("assert");
const fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..");
const css = fs.readFileSync(path.join(root, "extension", "media", "chat.css"), "utf8");

let failed = 0;
const check = (name, fn) => { try { fn(); console.log("ok  ", name); } catch (e) { failed++; console.error("FAIL", name, e.message); } };

const block = (sel) => { const i = css.indexOf(`${sel} {`); assert.ok(i >= 0, sel); return css.slice(i, css.indexOf("}", i)); };
const varsOf = (text) => Object.fromEntries([...text.matchAll(/--([a-z-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1], m[2]]));
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const lum = (c) => { const [r, g, b] = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const mix = (c, bg, p) => c.map((v, i) => Math.round(v * p + bg[i] * (1 - p)));

const dark = varsOf(block(":root")), light = { ...dark, ...varsOf(block("body.vscode-light")) };
const PANEL = { dark: rgb("#181818"), light: rgb("#f8f8f8") };   // Kural Dark's / Kural Light's side bar
const NAMES = ["green", "red", "yellow", "blue", "accent-hi"];

for (const [theme, vars] of [["dark", dark], ["light", light]]) {
  check(`Kural ${theme === "dark" ? "Dark" : "Light"}: callout and status colors are readable`, () => {
    const bad = [];
    for (const n of NAMES) {
      assert.ok(vars[n], `--${n}`);
      const c = rgb(vars[n]), bg = PANEL[theme], tint = mix(c, bg, 0.09);
      const a = contrast(c, bg), b = contrast(c, tint);
      if (a < 4.5 || b < 4.5) bad.push(`--${n} ${vars[n]}: ${a.toFixed(2)} on the panel, ${b.toFixed(2)} on its callout`);
    }
    assert.deepStrictEqual(bad, []);
  });
}

check("the guide tells the chat about the calm chat", () => {
  const guide = fs.readFileSync(path.join(root, "extension", "lib", "chat", "guide.js"), "utf8");
  for (const s of ["Ask about this question", "Claude's summary", "Pick, then Send", "Watch out"]) assert.ok(guide.includes(s), s);
});

// (In the top block: "Not released yet" until a release names it "What's new in <version>".)
check("the release notes have it, in the top block", () => {
  const notes = fs.readFileSync(path.join(root, "RELEASE_NOTES.md"), "utf8");
  assert.ok(/^## (Not released yet|What's new in )/.test(notes), "a block at the top");
  const next = notes.indexOf("\n## ", 1);
  const top = next < 0 ? notes : notes.slice(0, next);
  for (const s of ["thinking", "Ask about this question", "Send"]) assert.ok(top.includes(s), s);
});

console.log(failed ? `chat-colors: ${failed} FAILED` : "chat-colors: ALL PASS");
process.exit(failed ? 1 : 0);

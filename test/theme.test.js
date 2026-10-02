// Kural Light: is every text color readable on the background it sits on?
// Contrast ratio as in WCAG: 4.5:1 for text (AA), 3:1 for icons and line numbers.
const assert = require("assert");
const fs = require("fs"), path = require("path");

const theme = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "extension", "themes", "kural-light-color-theme.json"), "utf8"));
const c = theme.colors;
const lum = (hex) => {
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.replace("#", "").slice(i, i + 2), 16) / 255)
    .map((v) => v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

let fail = 0;
const need = (what, fg, bg, min) => {
  const r = ratio(fg, bg);
  if (r < min) { fail++; console.log(`FAIL ${what}: ${fg} on ${bg} = ${r.toFixed(2)}:1 (needs ${min}:1)`); }
  else console.log(`ok   ${what}: ${r.toFixed(1)}:1`);
};

// Code: every token color on the editor background.
for (const t of theme.tokenColors) if (t.settings.foreground) need(`code ${[].concat(t.scope)[0]}`, t.settings.foreground, c["editor.background"], 4.5);
for (const [k, v] of Object.entries(theme.semanticTokenColors)) need(`code (semantic) ${k}`, typeof v === "string" ? v : v.foreground, c["editor.background"], 4.5);
need("Tab suggestion (grey text)", c["editorGhostText.foreground"], c["editor.background"], 4.5);
need("line numbers", c["editorLineNumber.foreground"], c["editor.background"], 3);
need("active line number", c["editorLineNumber.activeForeground"], c["editor.background"], 4.5);

// The window around the code.
const pairs = [
  ["text", "foreground", "sideBar.background"], ["side bar", "sideBar.foreground", "sideBar.background"],
  ["descriptions", "descriptionForeground", "sideBar.background"], ["active tab", "tab.activeForeground", "tab.activeBackground"],
  ["other tabs", "tab.inactiveForeground", "tab.inactiveBackground"], ["status bar", "statusBar.foreground", "statusBar.background"],
  ["title bar", "titleBar.activeForeground", "titleBar.activeBackground"], ["input", "input.foreground", "input.background"],
  ["input placeholder", "input.placeholderForeground", "input.background"], ["buttons", "button.foreground", "button.background"],
  ["secondary buttons", "button.secondaryForeground", "button.secondaryBackground"], ["badges", "badge.foreground", "badge.background"],
  ["activity badge", "activityBarBadge.foreground", "activityBarBadge.background"], ["links", "textLink.foreground", "editor.background"],
  ["panel tabs", "panelTitle.inactiveForeground", "panel.background"], ["breadcrumbs", "breadcrumb.foreground", "editor.background"],
  ["code lens (Accept / Reject)", "editorCodeLens.foreground", "editor.background"], ["menus", "menu.foreground", "menu.background"],
  ["search matches in lists", "list.highlightForeground", "sideBar.background"], ["terminal text", "terminal.foreground", "terminal.background"],
];
for (const [what, fg, bg] of pairs) need(what, c[fg], c[bg], 4.5);
need("side bar icons", c["activityBar.inactiveForeground"], c["activityBar.background"], 3);
for (const k of Object.keys(c).filter((k) => /^terminal\.ansi/.test(k) && !/Black$|BrightBlack$/.test(k))) need(k, c[k], c["terminal.background"], 4.5);

// The chat, Ask and Tab panels' own colors in a light theme (body.vscode-light in their CSS).
const css = fs.readFileSync(path.join(__dirname, "..", "extension", "media", "chat.css"), "utf8");
const light = /body\.vscode-light \{([^}]*)\}/.exec(css)[1];
for (const m of light.matchAll(/--(accent|accent-hi|green|red|yellow|blue): (#[0-9a-f]{6})/g)) need(`chat panel ${m[1]}`, m[2], c["sideBar.background"], 4.5);

console.log(fail ? `theme: ${fail} FAILED` : "theme: ALL PASS");
process.exit(fail ? 1 : 0);

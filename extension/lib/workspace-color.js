// Workspace Color: tints the activity bar (the icon bar on the left) with a color per workspace, like the Peacock
// extension but only for that bar. The choice is saved in the WORKSPACE's settings (the .code-workspace file, or
// .vscode/settings.json of a single folder), so it is back whenever that folder opens.
//   - `workbench.colorCustomizations` gets six keys (KEYS), merged into what is already there: other keys stay.
//   - `kural.workspaceColor` remembers the chosen color. It marks the keys as Kural's: Remove deletes a key only when its
//     value is still what Kural wrote for that color, so colors you set by hand are never removed.
// The right-click item on the activity bar is added by scripts/rebrand.py (add_workspace_color_item); the command also
// works from the Command Palette ("Kural: Workspace Color...").
const vscode = require("vscode");

const KEYS = ["activityBar.background", "activityBar.foreground", "activityBar.inactiveForeground", "activityBar.activeBorder",
  "activityBarBadge.background", "activityBarBadge.foreground"];

// Two palettes of the same names, so the bar matches the theme: DARK (deep, muted: for dark themes, so the bar does not
// glare next to the dark editor) and LIGHT (soft pastels: for light themes). Every color passes 4.5:1 with its foreground.
const DARK = [
  { name: "Red", hex: "#642b2b" }, { name: "Orange", hex: "#6d472c" }, { name: "Yellow", hex: "#6d5e2c" },
  { name: "Green", hex: "#2b5a33" }, { name: "Teal", hex: "#265958" }, { name: "Blue", hex: "#2e476b" },
  { name: "Indigo", hex: "#3b3267" }, { name: "Purple", hex: "#513465" }, { name: "Pink", hex: "#68314d" },
  { name: "Brown", hex: "#50382b" }, { name: "Gray", hex: "#273549" },
];
const LIGHT = [
  { name: "Red", hex: "#edc0c0" }, { name: "Orange", hex: "#eacfb8" }, { name: "Yellow", hex: "#eae4b8" },
  { name: "Green", hex: "#bfe3c5" }, { name: "Teal", hex: "#b8e0df" }, { name: "Blue", hex: "#b0cce8" },
  { name: "Indigo", hex: "#c8caea" }, { name: "Purple", hex: "#dbc9e8" }, { name: "Pink", hex: "#edc9d8" },
  { name: "Brown", hex: "#dbc4b3" }, { name: "Gray", hex: "#d6dfeb" },
];

// ColorThemeKind: 1 = Light, 4 = High Contrast Light; everything else is a dark theme
const paletteFor = (kind) => (kind === 1 || kind === 4 ? LIGHT : DARK);

// "#abc" / "#aabbcc" (any case) -> "#aabbcc", else null
function normalizeHex(text) {
  const m = /^\s*#?([0-9a-f]{3}|[0-9a-f]{6})\s*$/i.exec(String(text || ""));
  if (!m) return null;
  let h = m[1].toLowerCase();
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  return "#" + h;
}

// WCAG relative luminance of "#rrggbb"
function luminance(hex) {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}
const contrast = (a, b) => { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

// white or near-black, whichever reads better on the color
function foregroundFor(hex) {
  return contrast(hex, "#ffffff") >= contrast(hex, "#1e1e1e") ? "#ffffff" : "#1e1e1e";
}

// the six colors for a bar color
function colorsFor(hex) {
  const fg = foregroundFor(hex);
  return {
    "activityBar.background": hex,
    "activityBar.foreground": fg,
    "activityBar.inactiveForeground": fg + "99",   // the same color, 60 % opaque
    "activityBar.activeBorder": fg,
    "activityBarBadge.background": fg,
    "activityBarBadge.foreground": hex,
  };
}

const plain = (o) => (o && typeof o === "object" && !Array.isArray(o) ? o : {});

// existing customizations + the bar's colors; nothing else is touched
function mergeColors(existing, hex) {
  return { ...plain(existing), ...colorsFor(hex) };
}

// existing customizations without the keys Kural wrote for `hex` (a key you changed since is kept); null when nothing is left
function removeColors(existing, hex) {
  const out = { ...plain(existing) };
  if (hex) {
    const wrote = colorsFor(hex);
    for (const k of KEYS) if (typeof out[k] === "string" && out[k].toLowerCase() === wrote[k]) delete out[k];
  }
  return Object.keys(out).length ? out : null;
}

const hasWorkspace = () => !!((vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length) || vscode.workspace.workspaceFile);
const WS = () => vscode.ConfigurationTarget.Workspace;
const workbench = () => vscode.workspace.getConfiguration("workbench");
const own = () => vscode.workspace.getConfiguration("kural");
const savedCustomizations = () => workbench().inspect("colorCustomizations").workspaceValue;
const savedColor = () => normalizeHex(own().inspect("workspaceColor").workspaceValue);

async function save(hex) {
  await workbench().update("colorCustomizations", mergeColors(savedCustomizations(), hex), WS());
  await own().update("workspaceColor", hex, WS());
}

async function clear() {
  const left = removeColors(savedCustomizations(), savedColor());
  await workbench().update("colorCustomizations", left || undefined, WS());
  await own().update("workspaceColor", undefined, WS());
}

async function ask() {
  if (!hasWorkspace()) {
    vscode.window.showInformationMessage("Open a folder first: a workspace color is saved in that folder's settings.");
    return;
  }
  const before = savedCustomizations();           // put back when you cancel (or pick Custom / Remove)
  const current = savedColor();
  const palette = paletteFor(vscode.window.activeColorTheme && vscode.window.activeColorTheme.kind);
  const qp = vscode.window.createQuickPick();
  qp.title = "Workspace Color";
  qp.placeholder = "Pick a color for this workspace's activity bar";
  qp.items = [
    ...palette.map((c) => ({ label: `$(circle-filled) ${c.name}`, description: c.hex === current ? `${c.hex}  (current)` : c.hex, hex: c.hex })),
    { label: "", kind: vscode.QuickPickItemKind.Separator },
    { label: "$(edit) Custom... (hex)", custom: true },
    { label: "$(close) Remove color", remove: true },
  ];
  // The preview writes the setting (it is how the bar changes), one write after another.
  let chain = Promise.resolve(), done = false;
  const write = (value) => { chain = chain.then(() => workbench().update("colorCustomizations", value, WS())).catch(() => {}); return chain; };
  // (The list's first item becomes active when it opens: not a preview, or opening and pressing Esc would leave a new
  // .vscode/settings.json behind.)
  let opened = false, previewed = false;
  qp.onDidChangeActive((active) => {
    if (!opened) { opened = true; if (active[0] === qp.items[0]) return; }
    if (!done && active[0] && active[0].hex) { previewed = true; write(mergeColors(before, active[0].hex)); }
  });
  const choice = await new Promise((resolve) => {
    qp.onDidAccept(() => { done = true; resolve(qp.selectedItems[0] || null); qp.hide(); });
    qp.onDidHide(() => { done = true; resolve(null); });
    qp.show();
  });
  qp.dispose();
  try {
    if (previewed) await write(before);           // back to how it was; the choice below saves for real
    if (!choice) return;
    if (choice.remove) { await clear(); return; }
    let hex = choice.hex;
    if (choice.custom) {
      const text = await vscode.window.showInputBox({
        title: "Workspace Color", prompt: "A color as hex: #rgb or #rrggbb", value: current || "", placeHolder: "#2f6fdb",
        validateInput: (v) => (normalizeHex(v) ? undefined : "Use a hex color like #2f6fdb or #28d"),
      });
      hex = normalizeHex(text);
      if (!hex) return;
    }
    await save(hex);
  } catch (e) {
    vscode.window.showWarningMessage(`Kural could not save the workspace color: ${e.message || e}`);
  }
}

function register(context) {
  context.subscriptions.push(vscode.commands.registerCommand("kural.workspaceColor", ask));
}

module.exports = { register, ask, normalizeHex, luminance, contrast, foregroundFor, colorsFor, mergeColors, removeColors, paletteFor, KEYS, DARK, LIGHT };

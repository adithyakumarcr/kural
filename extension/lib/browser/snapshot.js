// A page as the AI reads it: its accessibility tree (what a screen reader gets: roles, names, values, states, from
// Chromium itself: CDP's Accessibility.getFullAXTree) as a short outline, with a ref for each thing on it ("[e12]") that
// the browser tools take. No vscode here.
//
//   - dialog "Create new reel" [e3]
//     - heading "Create new reel" (level 1) [e4]
//     - button "Next" [e5]
//     - textbox "Write a caption…" [e7]: "Morning run"
//     - button "Share" [e8] (publishes: Kural won't press it)
//     - "Some text on the page."
//
// build(nodes, opts) → { text, refs: Map(ref → { backend, role, name }), lines }
//   opts.refFor(backendNodeId) → "e12": page.js gives an element the same ref in every snapshot while the page lives, so an
//   old ref means the same element (or nothing), never another one.

const { classifyLabel, isSearchLabel } = require("./guard");

// Things the AI can act on.
const INTERACTIVE = new Set(["button", "link", "textbox", "searchbox", "combobox", "listbox", "option", "checkbox", "radio", "switch",
  "slider", "spinbutton", "menuitem", "menuitemcheckbox", "menuitemradio", "tab", "treeitem", "scrollbar", "ToggleButton", "PopUpButton"]);
// Shown with their name (a landmark or a container that tells where you are), unnamed ones only when they always help.
const ALWAYS = new Set(["dialog", "alertdialog", "heading", "alert", "main", "navigation", "video", "audio", "Iframe", "IframePresentational",
  "progressbar", "meter", "image", "img", "figure", "table", "tooltip", "Canvas"]);
const NAMED = new Set(["region", "form", "article", "banner", "complementary", "contentinfo", "search", "list", "menu", "menubar", "tablist",
  "tabpanel", "toolbar", "group", "radiogroup", "tree", "grid", "status", "log", "note", "row", "cell", "gridcell", "columnheader", "rowheader"]);
// Whose own text is their name: their children aren't listed again.
const LEAF = new Set(["button", "link", "checkbox", "radio", "switch", "tab", "menuitem", "menuitemcheckbox", "menuitemradio", "option",
  "textbox", "searchbox", "slider", "spinbutton", "heading", "image", "img", "progressbar", "meter", "ToggleButton", "treeitem",
  "columnheader", "rowheader", "cell", "gridcell", "scrollbar"]);
const BUTTONLIKE = new Set(["button", "link", "menuitem", "PopUpButton", "ToggleButton"]);
const SKIP = new Set(["InlineTextBox", "LineBreak", "ListMarker"]);

const MAX_CHARS = 24000;
const clip = (s, n) => { s = String(s == null ? "" : s).replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1) + "…" : s; };
const q = (s) => JSON.stringify(s);
const val = (v) => v && v.value !== undefined ? v.value : undefined;

function props(n) {
  const out = {};
  for (const p of n.properties || []) out[p.name] = val(p.value);
  return out;
}

// nodes: CDP AXNode list (any order).
function build(nodes, { maxChars = MAX_CHARS, refFor } = {}) {
  const byId = new Map(nodes.map((n) => [n.nodeId, n]));
  const root = nodes.find((n) => !n.parentId || !byId.has(n.parentId)) || nodes[0];
  const refs = new Map();
  const lines = [];
  let next = 1;
  const refOf = refFor || (() => `e${next++}`);
  // Is there a text box being written in (or a video) close to this node? (For "Post" / "Comment" / "Reply": see guard.js.)
  const editableBelow = new Map();
  const isEditable = (n) => !n.ignored && val(n.role) === "textbox" && props(n).editable !== undefined && !isSearchLabel(val(n.name));
  const countEditable = (n, depth = 0) => {
    if (!n || depth > 400) return 0;
    if (editableBelow.has(n.nodeId)) return editableBelow.get(n.nodeId);
    let c = isEditable(n) || val(n.role) === "video" ? 1 : 0;
    for (const id of n.childIds || []) c += countEditable(byId.get(id), depth + 1);
    editableBelow.set(n.nodeId, c);
    return c;
  };
  if (root) countEditable(root);
  let text = [];   // text runs waiting to be written as one line
  const flush = (depth) => {
    const t = clip(text.join(""), 300);
    text = [];
    if (t) lines.push(`${"  ".repeat(depth)}- ${q(t)}`);
  };

  function walk(n, depth, ancestors) {
    if (!n || ancestors.length > 300) return;
    const role = val(n.role) || "";
    if (SKIP.has(role)) return;
    const kids = () => (n.childIds || []).map((id) => byId.get(id)).filter(Boolean);
    if (n.ignored || role === "RootWebArea") { for (const c of kids()) walk(c, depth, ancestors); return; }
    const name = clip(val(n.name), 120);
    if (role === "StaticText") { if (name) text.push(text.length && !/\s$/.test(text[text.length - 1]) && !/^\s/.test(val(n.name)) ? " " + val(n.name) : val(n.name)); return; }
    const p = props(n);
    const shown = INTERACTIVE.has(role) || ALWAYS.has(role) || (NAMED.has(role) && name);
    if (!shown) { for (const c of kids()) walk(c, depth, [...ancestors, n]); return; }
    flush(depth);
    const bits = [];
    if (role === "heading" && p.level) bits.push(`level ${p.level}`);
    if (p.checked === "true" || p.checked === true) bits.push("checked");
    else if (p.checked === "mixed") bits.push("partly checked");
    else if (p.checked === "false" || p.checked === false) bits.push("not checked");
    if (p.pressed === "true" || p.pressed === true) bits.push("pressed");
    if (p.selected === true && role !== "option") bits.push("selected");
    if (p.expanded === true) bits.push("expanded"); else if (p.expanded === false && role !== "combobox") bits.push("collapsed");
    if (p.disabled) bits.push("disabled");
    if (p.required) bits.push("required");
    if (p.invalid && p.invalid !== "false") bits.push("invalid");
    if (p.focused) bits.push("focused");
    if (role === "slider" || role === "spinbutton" || role === "progressbar" || role === "meter") {
      const range = p.valuemin !== undefined && p.valuemax !== undefined ? ` of ${p.valuemin}–${p.valuemax}` : "";
      if (val(n.value) !== undefined) bits.push(`value ${clip(p.valuetext || val(n.value), 40)}${range}`);
    }
    // "Share" and its kind: marked, so the AI doesn't try (the real check is when it clicks: guard.classifyClick).
    // (Like guard's composer in the page: the nearest containers, up to a dialog or form, not past navigation or main.)
    if (BUTTONLIKE.has(role) && name) {
      let near = false;
      for (let i = ancestors.length - 1, k = 0; i >= 0 && k < 6; i--, k++) {
        const r = val(ancestors[i].role);
        if (["navigation", "main", "banner", "contentinfo"].includes(r)) break;
        if ((editableBelow.get(ancestors[i].nodeId) || 0) > 0) { near = true; break; }
        if (["dialog", "alertdialog", "form", "article"].includes(r)) break;
      }
      if (classifyLabel(name, { composer: near }).kind === "publish") bits.push("publishes: Kural won't press it");
    }
    let ref = "";
    if (n.backendDOMNodeId) { ref = refOf(n.backendDOMNodeId); refs.set(ref, { backend: n.backendDOMNodeId, role, name }); }
    let line = `${"  ".repeat(depth)}- ${role}${name ? ` ${q(name)}` : ""}${bits.length ? ` (${bits.join(", ")})` : ""}${ref ? ` [${ref}]` : ""}`;
    const value = val(n.value);
    if (["textbox", "searchbox", "combobox"].includes(role) && value !== undefined && String(value) !== "" && String(value) !== name) line += `: ${q(clip(value, 200))}`;
    // A <select>'s choices, in one line.
    if (role === "combobox") {
      const opts = [];
      const collect = (c) => { if (!c || opts.length > 30) return; if (val(c.role) === "option" && val(c.name)) opts.push(clip(val(c.name), 40)); for (const id of c.childIds || []) collect(byId.get(id)); };
      for (const c of kids()) collect(c);
      if (opts.length) line += ` (choices: ${opts.slice(0, 25).join(" | ")}${opts.length > 25 ? " | …" : ""})`;
    }
    lines.push(line);
    if (role === "combobox" && p.expanded !== true) return;
    if (LEAF.has(role)) return;
    for (const c of kids()) walk(c, depth + 1, [...ancestors, n]);
    flush(depth + 1);
  }
  if (root) walk(root, 0, []);
  flush(0);
  // Long pages: cut at a line, and say so.
  let out = "", cut = 0;
  for (let i = 0; i < lines.length; i++) {
    if (out.length + lines[i].length + 1 > maxChars) { cut = lines.length - i; break; }
    out += (out ? "\n" : "") + lines[i];
  }
  if (cut) out += `\n… (${cut} more lines not shown: scroll down and take a new snapshot, or take a snapshot with "find")`;
  return { text: out, refs, lines: lines.length };
}

// Only the lines that contain the words (and the lines they're inside of, for where they are), for "find".
function filter(text, words) {
  const want = String(words || "").toLowerCase().trim();
  if (!want) return text;
  const lines = String(text).split("\n");
  const keep = new Set();
  lines.forEach((l, i) => {
    if (!l.toLowerCase().includes(want)) return;
    keep.add(i);
    let depth = l.search(/\S/);
    for (let j = i - 1; j >= 0 && depth > 0; j--) { const d = lines[j].search(/\S/); if (d < depth) { keep.add(j); depth = d; } }
  });
  if (!keep.size) return `(Nothing on the page says "${words}".)`;
  return [...keep].sort((a, b) => a - b).map((i) => lines[i]).join("\n");
}

module.exports = { build, filter, MAX_CHARS };

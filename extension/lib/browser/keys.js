// Key names the AI uses ("Enter", "Escape", "ArrowDown", "Control+A", "Shift+Tab", "a") → what CDP's Input.dispatchKeyEvent
// needs to press them like a keyboard. No vscode here.
// "ControlOrMeta" is Command on a Mac and Control elsewhere (select all, copy, paste); on a Mac, Chromium only runs such
// editing shortcuts when they come with their command name (`commands`), so those are added.

const NAMED = {
  Enter: { code: "Enter", keyCode: 13, text: "\r" }, Tab: { code: "Tab", keyCode: 9 }, Escape: { code: "Escape", keyCode: 27 },
  Backspace: { code: "Backspace", keyCode: 8 }, Delete: { code: "Delete", keyCode: 46 }, " ": { code: "Space", keyCode: 32, text: " " },
  ArrowUp: { code: "ArrowUp", keyCode: 38 }, ArrowDown: { code: "ArrowDown", keyCode: 40 }, ArrowLeft: { code: "ArrowLeft", keyCode: 37 },
  ArrowRight: { code: "ArrowRight", keyCode: 39 }, Home: { code: "Home", keyCode: 36 }, End: { code: "End", keyCode: 35 },
  PageUp: { code: "PageUp", keyCode: 33 }, PageDown: { code: "PageDown", keyCode: 34 }, Insert: { code: "Insert", keyCode: 45 },
};
for (let i = 1; i <= 12; i++) NAMED[`F${i}`] = { code: `F${i}`, keyCode: 111 + i };
const ALIASES = { esc: "Escape", return: "Enter", space: " ", spacebar: " ", up: "ArrowUp", down: "ArrowDown", left: "ArrowLeft", right: "ArrowRight",
  del: "Delete", pgup: "PageUp", pgdn: "PageDown", backspace: "Backspace", enter: "Enter", tab: "Tab", escape: "Escape", delete: "Delete",
  home: "Home", end: "End", pageup: "PageUp", pagedown: "PageDown", arrowup: "ArrowUp", arrowdown: "ArrowDown", arrowleft: "ArrowLeft", arrowright: "ArrowRight",
  numpadenter: "Enter" };
const MODS = { alt: 1, option: 1, control: 2, ctrl: 2, meta: 4, command: 4, cmd: 4, shift: 8 };
const MAC_COMMANDS = { "4:a": "selectAll", "4:c": "copy", "4:x": "cut", "4:v": "paste", "4:z": "undo", "12:z": "redo" };

// "Control+Shift+A" → { key, code, keyCode, text?, modifiers (CDP bit field), mods: { alt, ctrl, meta, shift }, commands? } | null
function parse(combo, platform = process.platform) {
  const parts = String(combo || "").split("+").map((s) => s.trim());
  // ("Control++" means the + key)
  if (parts.length > 1 && parts[parts.length - 1] === "" && parts[parts.length - 2] === "") parts.splice(-2, 2, "+");
  let main = parts.pop();
  if (!main && main !== " ") return null;
  if (String(combo) === " ") main = " ";
  let modifiers = 0;
  for (const m of parts) {
    const k = m.toLowerCase();
    if (k === "controlormeta" || k === "mod") modifiers |= platform === "darwin" ? 4 : 2;
    else if (MODS[k]) modifiers |= MODS[k];
    else return null;
  }
  const name = NAMED[main] ? main : ALIASES[main.toLowerCase()] || (main.length === 1 ? main : null);
  if (!name) return null;
  let def;
  if (NAMED[name]) def = { key: name, ...NAMED[name] };
  else {
    const ch = name;
    const shifted = modifiers & 8;
    const key = /[a-z]/i.test(ch) ? (shifted ? ch.toUpperCase() : ch.toLowerCase()) : ch;
    const code = /[a-z]/i.test(ch) ? `Key${ch.toUpperCase()}` : /\d/.test(ch) ? `Digit${ch}` : "";
    def = { key, code, keyCode: /[a-z\d]/i.test(ch) ? ch.toUpperCase().charCodeAt(0) : ch.charCodeAt(0), text: key };
  }
  // A shortcut (Control, Alt or Command held) types nothing.
  if (modifiers & 7) delete def.text;
  const out = { ...def, modifiers, mods: { alt: !!(modifiers & 1), ctrl: !!(modifiers & 2), meta: !!(modifiers & 4), shift: !!(modifiers & 8) } };
  const cmd = platform === "darwin" && MAC_COMMANDS[`${modifiers}:${String(def.key).toLowerCase()}`];
  if (cmd) out.commands = [cmd];
  return out;
}

// The two events of one key press.
function events(k) {
  const base = { modifiers: k.modifiers, key: k.key, code: k.code, windowsVirtualKeyCode: k.keyCode, nativeVirtualKeyCode: k.keyCode };
  return [
    { type: k.text ? "keyDown" : "rawKeyDown", ...base, ...(k.text ? { text: k.text, unmodifiedText: k.text } : {}), ...(k.commands ? { commands: k.commands } : {}) },
    { type: "keyUp", ...base },
  ];
}

module.exports = { parse, events };

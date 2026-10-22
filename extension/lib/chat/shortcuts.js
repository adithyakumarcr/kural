// Your shortcuts (issue #107): "/pr-summary" in the chat box stands for a text you wrote once, in Kural Settings →
// Shortcuts. No vscode here.
//
// Kept in the user setting kural.chat.shortcuts ([{ name, text }]), read from your user settings only (like your moods:
// a project's settings can't add or change one, since the text goes to the AI). Kural puts the text in itself, so they
// work with every AI. In the box a shortcut is a chip ({ kind: "shortcut", name, text, label }) that reads as
// "/pr-summary" everywhere (History, the tab's title, handoffs); the AI gets the text in the message's context block.
// "/pr-summary" typed by hand counts too, as a whole word that is one of your shortcuts. Yours wins over a Claude skill
// with the same name.

const LIMITS = { name: 40, text: 4000 };
const NAME_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;

// A name as you might type it ("PR summary", "/pr_summary") → "pr-summary"; "" when nothing is left.
const nameOf = (s) => String(s == null ? "" : s).trim().replace(/^\/+/, "").toLowerCase().replace(/[^a-z0-9]+/g, "-")
  .replace(/^-+|-+$/g, "").slice(0, LIMITS.name).replace(/-+$/, "");

// The setting, cleaned up: a valid name and some text each, the first of a name wins.
function clean(list) {
  const out = [], seen = new Set();
  for (const s of Array.isArray(list) ? list : []) {
    if (!s || typeof s !== "object" || typeof s.name !== "string") continue;
    const name = s.name.trim().replace(/^\//, ""), text = String(s.text == null ? "" : s.text).trim().slice(0, LIMITS.text);
    if (!NAME_RE.test(name) || !text || seen.has(name)) continue;
    seen.add(name);
    out.push({ name, text });
  }
  return out;
}

// Why a shortcut can't be saved ("" when it can). others: your other shortcuts.
function problem(name, text, others = []) {
  if (!name) return "Give the shortcut a name: letters, digits and -, like pr-summary.";
  if (!NAME_RE.test(name)) return `Use lowercase letters, digits and - in the name (up to ${LIMITS.name} characters).`;
  if (!String(text || "").trim()) return "Write what the shortcut stands for.";
  if (String(text).trim().length > LIMITS.text) return `Keep the text to ${LIMITS.text} characters.`;
  if (others.some((s) => s.name === name)) return `There's already a shortcut called /${name}.`;
  return "";
}

// The names typed by hand in a message ("hi! please do /pr-summary"): "/" at the start or after a space, a whole word.
function typed(text) {
  const out = [];
  for (const m of String(text || "").matchAll(/(?:^|\s)\/([a-z0-9][a-z0-9-]*)(?=$|[\s.,!?;:)\]"'])/g)) out.push(m[1]);
  return out;
}

// What the AI gets for the shortcuts in a message: one part per shortcut, each once. Chips first, in order, then the
// ones typed by hand that are yours. A chip whose shortcut you've since deleted keeps the text it was made with; one you
// changed sends the new text.
function notes(text, contexts, mine) {
  const byName = new Map(clean(mine).map((s) => [s.name, s.text])), seen = new Set(), out = [];
  const add = (name, body) => {
    if (seen.has(name) || !body) return;
    seen.add(name);
    out.push(`My shortcut /${name} means:\n${String(body).slice(0, LIMITS.text).split("\n").map((l) => `> ${l}`).join("\n")}`);
  };
  for (const c of contexts || []) {
    if (!c || c.kind !== "shortcut" || typeof c.name !== "string" || !NAME_RE.test(c.name)) continue;
    add(c.name, byName.get(c.name) || (typeof c.text === "string" ? c.text.trim() : ""));
  }
  for (const name of typed(text)) if (byName.has(name)) add(name, byName.get(name));
  return out;
}

module.exports = { LIMITS, NAME_RE, nameOf, clean, problem, typed, notes };

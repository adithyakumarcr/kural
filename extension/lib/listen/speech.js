// Listen: the walkthrough's text made ready for the voice (no vscode inside). The model is asked for plain spoken
// English, but it sometimes leaves markdown, symbols or emoji in, and the voice would say them; tech words it says badly
// ("npm", "JSON") are spelled the way a person says them. Expression tags (<laugh>…) stay only when the voice can say them.

// Whole words, case-sensitive (so "api" in a sentence isn't touched, only the acronym).
const PRONOUNCE = [
  [/\.js\b/g, " dot J S"],
  [/\bnpm\b/g, "N P M"],
  [/\bJSON\b/g, "jason"],
  [/\bCLI\b/g, "C L I"],
  [/\bUI\b/g, "U I"],
  [/\bAPI\b/g, "A P I"],
  [/\bREADME\b/g, "read me"],
];

// After . ! or ? followed by a space: never inside "1.2" or "node.js" (no space there).
function sentences(text) {
  return String(text || "").split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
}

function forVoice(text, tags = []) {
  const keep = new Set(tags);
  const lines = String(text || "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")                 // links: their text
    .replace(/`+/g, "")                                      // inline code marks
    .replace(/\*\*|__|\*/g, "")                              // emphasis
    .split("\n")
    .map((l) => l.replace(/^\s*(?:[-*+]|\d+\.)\s+/, "").replace(/^\s*#+\s*/, "").trim())
    .filter(Boolean);
  // Lines join into sentences: one without an end mark gets a period (a list item, a heading).
  let out = lines.map((l, i) => (i < lines.length - 1 && !/[.!?:;,]$/.test(l) ? `${l}.` : l)).join(" ");
  out = out.replace(/<\/?([a-z]+)>/gi, (m, name) => (keep.has(name.toLowerCase()) && !m.startsWith("</") ? `<${name.toLowerCase()}>` : " "));
  out = out.replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, " ").replace(/_/g, " ");
  for (const [re, say] of PRONOUNCE) out = out.replace(re, say);
  return out.replace(/\s+/g, " ").replace(/\s+([.,!?;:])/g, "$1").trim();
}

module.exports = { sentences, forVoice, PRONOUNCE };

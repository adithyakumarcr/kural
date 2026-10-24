// Ctrl+K's Quick Question (no vscode inside; like Cursor's): a question about the selected code, answered right in
// Ctrl+K's box by the fastest model you have (Haiku, or the lightest Gemini / Codex model), without tools: it only answers.
// The box remembers what was asked in it, so you can ask again, or press Enter to turn it into an edit (the edit is told
// what was asked: "do what you suggested" works).
const MAX_REGION = 12000;     // the selected code (or the line you're on)
const MAX_AROUND = 3000;      // the code before and after it, each
const MAX_QUESTION = 2000;
const MAX_EARLIER = 6;        // earlier questions of this box in the prompt
const MAX_EARLIER_ANSWER = 1500;

const SYSTEM_PROMPT = "You answer a quick question about code the user selected in their editor. Be brief: a few " +
  "sentences, or a small code snippet when it helps. Don't repeat the selected code back. You have no tools and change " +
  "nothing: answer from the code you are given and what you know. Plain Markdown, no headings.";

const clip = (s, n) => { s = String(s == null ? "" : s); return s.length > n ? `${s.slice(0, n)}…` : s; };
const tail = (s, n) => { s = String(s == null ? "" : s); return s.length > n ? `…${s.slice(-n)}` : s; };

// file: its path in the project · lang: VS Code's language id · region: the selected lines (or the line you're on) ·
// before/after: the code around it · selected: false when nothing was selected · talk: [{ q, a }] asked earlier in this box.
function buildPrompt({ file, lang, region, before, after, selected = true, talk = [], question }) {
  const earlier = (talk || []).filter((t) => t && t.q && t.a).slice(-MAX_EARLIER);
  return [
    `File: ${file}${lang ? ` (${lang})` : ""}`,
    before ? `<before>\n${tail(before, MAX_AROUND)}\n</before>` : "",
    selected ? `<selection>\nThe code the user selected:\n${clip(region, MAX_REGION)}\n</selection>`
      : `<cursor_line>\nNothing is selected; the line the user is on:\n${clip(region, MAX_REGION)}\n</cursor_line>`,
    after ? `<after>\n${clip(after, MAX_AROUND)}\n</after>` : "",
    earlier.length ? `<earlier>\n${earlier.map((t) => `Question: ${clip(t.q, MAX_QUESTION)}\nAnswer: ${clip(t.a, MAX_EARLIER_ANSWER)}`).join("\n\n")}\n</earlier>` : "",
    `Question about the ${selected ? "selection" : "code here"}:\n${clip(question, MAX_QUESTION)}`,
  ].filter(Boolean).join("\n\n");
}

// What the edit is told about the questions asked in the box before it (empty: none).
function talkNote(talk) {
  const earlier = (talk || []).filter((t) => t && t.q && t.a).slice(-MAX_EARLIER);
  if (!earlier.length) return "";
  return "Before this instruction the user asked about this code (their questions and the answers they got):\n" +
    earlier.map((t) => `Question: ${clip(t.q, MAX_QUESTION)}\nAnswer: ${clip(t.a, MAX_EARLIER_ANSWER)}`).join("\n\n") + "\n\n";
}

// The model's reply, ready to show: trimmed; nothing → null.
function tidy(reply) {
  if (reply == null) return null;
  const s = String(reply).replace(/^\s*<answer>\s*|\s*<\/answer>\s*$/g, "").trim();
  return s || null;
}

module.exports = { SYSTEM_PROMPT, buildPrompt, talkNote, tidy, MAX_QUESTION };

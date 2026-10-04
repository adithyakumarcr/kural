// Files you attach to a chat message: with the + button, by dropping them on the chat, or by
// pasting (a screenshot). Images and PDFs go to Claude directly, so it can see them; text files
// are pasted into the message; anything else is passed by its path for Claude to open.

const path = require("path");
const fs = require("fs");
const os = require("os");

const IMAGE_TYPES = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp" };
const MAX_IMAGE = 5 * 1024 * 1024;       // Claude's limit per image
const MAX_PDF = 30 * 1024 * 1024;
const MAX_TEXT = 120 * 1024;
const THUMB_MAX = 3 * 1024 * 1024;       // pictures up to this size get a preview in the chat box

const dir = path.join(os.tmpdir(), "kural-attachments");
const newId = () => Math.random().toString(36).slice(2, 10);

function kindOf(file, size) {
  const ext = path.extname(file).toLowerCase();
  if (IMAGE_TYPES[ext]) return size <= MAX_IMAGE ? "image" : "file";
  if (ext === ".pdf") return size <= MAX_PDF ? "pdf" : "file";
  if (size <= MAX_TEXT && looksLikeText(file)) return "text";
  return "file";
}

function looksLikeText(file) {
  try {
    const fd = fs.openSync(file, "r");
    const buf = Buffer.alloc(8192);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
    return !buf.subarray(0, n).includes(0);
  } catch { return false; }
}

class Attachments {
  constructor() { this.items = new Map(); }

  // A file on disk -> an attachment (what the chat box shows).
  add(file) {
    let st;
    try { st = fs.statSync(file); } catch { return null; }
    if (st.isDirectory()) {
      const a = { id: newId(), name: path.basename(file) + "/", path: file, kind: "folder", size: 0 };
      this.items.set(a.id, a);
      return this.view(a);
    }
    const a = { id: newId(), name: path.basename(file), path: file, kind: kindOf(file, st.size), size: st.size };
    this.items.set(a.id, a);
    return this.view(a);
  }

  // Dropped or pasted data (no path of its own): save it to a temp folder first.
  addData(name, base64) {
    const id = newId();
    const safe = (name || "file").replace(/[\\/:*?"<>|]/g, "_").slice(0, 120) || "file";
    const d = path.join(dir, id);
    fs.mkdirSync(d, { recursive: true });
    const file = path.join(d, safe);
    fs.writeFileSync(file, Buffer.from(base64 || "", "base64"));
    return this.add(file);
  }

  view(a) {
    let thumb = null;
    if (a.kind === "image" && a.size <= THUMB_MAX) {
      try { thumb = `data:${IMAGE_TYPES[path.extname(a.path).toLowerCase()]};base64,${fs.readFileSync(a.path).toString("base64")}`; } catch { /* no preview */ }
    }
    return { id: a.id, name: a.name, kind: a.kind, size: a.size, path: a.path, thumb };
  }

  // The message for Claude: your text, plus each attachment in the best form Claude can take.
  content(prompt, ids) {
    const list = (ids || []).map((id) => this.items.get(id)).filter(Boolean);
    if (!list.length) return { content: prompt, meta: [] };
    const blocks = [];
    const notes = [];
    let text = "";
    for (const a of list) {
      try {
        if (a.kind === "image") {
          blocks.push({ type: "image", source: { type: "base64", media_type: IMAGE_TYPES[path.extname(a.path).toLowerCase()], data: fs.readFileSync(a.path).toString("base64") } });
          notes.push(`${a.name} (image, attached)`);
        } else if (a.kind === "pdf") {
          blocks.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: fs.readFileSync(a.path).toString("base64") }, title: a.name });
          notes.push(`${a.name} (PDF, attached)`);
        } else if (a.kind === "text") {
          text += `\n\nAttached file ${a.path}:\n\`\`\`${path.extname(a.path).slice(1)}\n${fs.readFileSync(a.path, "utf8")}\n\`\`\``;
        } else if (a.kind === "folder") {
          notes.push(`the folder ${a.path} (use your tools to look inside)`);
        } else {
          notes.push(`${a.path} (${Math.round(a.size / 1024)} KB; open it with your tools if you need it)`);
        }
      } catch { notes.push(`${a.path} (couldn't be read)`); }
    }
    const intro = notes.length ? `\n\nI attached: ${notes.join("; ")}.` : "";
    const meta = list.map((a) => ({ name: a.name, kind: a.kind, path: a.path }));
    for (const id of ids) this.items.delete(id);
    return { content: blocks.length ? [{ type: "text", text: prompt + intro + text }, ...blocks] : prompt + intro + text, meta };
  }
}

module.exports = { Attachments };

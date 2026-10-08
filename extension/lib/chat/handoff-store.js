// A complete, private record for recovering the details omitted from a compacted provider handoff. No vscode.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { entries } = require("../router/journal");

// Read tools clip very long lines. Encode long strings as small chunks so every character can be read with offset/limit.
function chunkText(value) {
  if (typeof value === "string" && JSON.stringify(value).length > 1800) {
    const chunks = [];
    const add = (s) => {
      if (JSON.stringify(s).length <= 1800) chunks.push(s);
      else { const mid = Math.floor(s.length / 2); add(s.slice(0, mid)); add(s.slice(mid)); }
    };
    for (let i = 0; i < value.length; i += 800) add(value.slice(i, i + 800));
    return { kural_text_chunks: chunks };
  }
  if (Array.isArray(value)) return value.map(chunkText);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, v]) => [key, chunkText(v)]));
  return value;
}

function directory(base, id) {
  // IDs from saved chats never become paths. A per-chat directory gives providers access only to this chat's record.
  return path.join(base, crypto.createHash("sha256").update(String(id)).digest("hex").slice(0, 32));
}

function save(messages, dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, "history.json");
  const tmp = path.join(dir, `${crypto.randomUUID()}.tmp`);
  try {
    fs.writeFileSync(tmp, JSON.stringify({ format: "kural-visible-history-v1", messages: chunkText(entries(messages)) }, null, 2) + "\n", { mode: 0o600, flag: "wx" });
    fs.renameSync(tmp, file);
  } finally {
    try { fs.unlinkSync(tmp); } catch { /* renamed, or never created */ }
  }
  return { path: file, format: "kural-visible-history-v1" };
}

module.exports = { directory, save };

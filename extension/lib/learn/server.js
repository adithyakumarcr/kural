// Lesson pages (Learn mood): the AI writes a slide deck as one HTML file into the chat's own lesson folder; this little web
// server shows it in Kural's browser (which opens only http/https addresses). No vscode inside.
//
//   Address:  http://127.0.0.1:<port>/<token>/<chat id>/<file>.html. Only 127.0.0.1, a random port, a random 32-byte token
//             in every path, and the Host header must be that address (a web page elsewhere can't reach it by a DNS trick).
//   A page:   the AI's file, with Kural's slide runtime added (media/lesson.css + lesson.js: arrows, progress, reveal steps,
//             "Add to chat" on a selection or on a visual marked data-concept). Its Content-Security-Policy lets it load
//             only from this server and inline code: no outside scripts, fonts, pictures or requests, so a lesson page is
//             self-contained and can't send anything anywhere.
//   Add:      POST .../<chat id>/add {text, slide, title, concept} (from the same address only, ≤ 16 KB) → onAdd(chat, item):
//             it becomes a pill in that chat's message box. Nothing is sent to the AI until you send.
//   Reload:   GET .../<chat id>/__v?f=<file> answers the file's time; the page asks every second and reloads when the AI
//             changed it (staying on its slide).

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const TYPES = {
  ".html": "text/html; charset=utf-8", ".htm": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".mp4": "video/mp4",
  ".webm": "video/webm", ".mp3": "audio/mpeg", ".wav": "audio/wav", ".woff2": "font/woff2",
};
const CSP = "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; " +
  "font-src 'self' data:; media-src 'self' data: blob:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const MAX_ADD = 16 * 1024;
const MAX_TEXT = 8000;
const CHAT_ID = /^[A-Za-z0-9_-]{1,80}$/;

// The runtime goes in right after <head> (before the AI's own styles, which may override it), or first when there's none.
function inject(html, base) {
  const tags = `<meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="${base}__kural/lesson.css">` +
    `<script src="${base}__kural/lesson.js" defer></script>`;
  const m = /<head(\s[^>]*)?>/i.exec(html);
  return m ? html.slice(0, m.index + m[0].length) + tags + html.slice(m.index + m[0].length) : tags + html;
}

const clip = (v, n) => String(v == null ? "" : v).slice(0, n);

class LessonServer {
  // root(chatId): that chat's lesson folder. media: the folder with lesson.css / lesson.js. onAdd(chatId, item).
  constructor({ root, media, onAdd, log = () => {} }) {
    this.root = root; this.media = media; this.onAdd = onAdd; this.log = log;
    this.token = crypto.randomBytes(32).toString("hex");
    this.server = null; this.port = 0; this.starting = null;
  }

  start() {
    if (this.starting) return this.starting;
    this.starting = new Promise((resolve, reject) => {
      const s = http.createServer((req, res) => this.handle(req, res).catch((e) => { this.log(`lesson server: ${e.message}`); this.send(res, 500, "text/plain", "Error"); }));
      s.on("error", (e) => { this.starting = null; reject(e); });
      s.listen(0, "127.0.0.1", () => { this.server = s; this.port = s.address().port; resolve(this.port); });
    });
    return this.starting;
  }

  stop() { if (this.server) this.server.close(); this.server = null; this.starting = null; }

  async url(chatId, file) {
    await this.start();
    return `http://127.0.0.1:${this.port}/${this.token}/${encodeURIComponent(chatId)}/${encodeURIComponent(path.basename(file))}`;
  }

  send(res, code, type, body, extra = {}) {
    res.writeHead(code, { "Content-Type": type, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", ...extra });
    res.end(body);
  }

  async handle(req, res) {
    const self = `127.0.0.1:${this.port}`;
    if (req.headers.host !== self) return this.send(res, 403, "text/plain", "Forbidden");
    const u = new URL(req.url, `http://${self}`);
    const parts = u.pathname.split("/").slice(1).map((p) => { try { return decodeURIComponent(p); } catch { return "\0"; } });
    if (parts.length < 3 || !crypto.timingSafeEqual(Buffer.from(crypto.createHash("sha256").update(parts[0]).digest()), Buffer.from(crypto.createHash("sha256").update(this.token).digest())))
      return this.send(res, 404, "text/plain", "Not found");
    const [, chat, ...rest] = parts;
    const name = rest.join("/");
    if (chat === "__kural" && rest.length === 1) return this.runtime(res, rest[0]);
    if (!CHAT_ID.test(chat)) return this.send(res, 404, "text/plain", "Not found");
    if (name === "add") return req.method === "POST" ? this.add(req, res, chat, self) : this.send(res, 405, "text/plain", "POST only");
    if (req.method !== "GET" && req.method !== "HEAD") return this.send(res, 405, "text/plain", "GET only");
    const dir = this.root(chat);
    if (name === "__v") {
      const f = this.fileIn(dir, u.searchParams.get("f") || "");
      let t = 0;
      try { if (f) t = fs.statSync(f).mtimeMs; } catch { /* gone */ }
      return this.send(res, 200, "application/json", JSON.stringify({ t }));
    }
    const file = this.fileIn(dir, name);
    if (!file) return this.send(res, 404, "text/plain", "Not found");
    const ext = path.extname(file).toLowerCase();
    const type = TYPES[ext] || "application/octet-stream";
    let body = fs.readFileSync(file);
    if (/^text\/html/.test(type)) body = inject(body.toString("utf8"), `/${this.token}/`);
    return this.send(res, 200, type, body, { "Content-Security-Policy": CSP });
  }

  // A file inside the chat's lesson folder (links followed, then checked again), not a hidden one; else null.
  fileIn(dir, name) {
    if (!dir || !name || name.split(/[\\/]/).some((p) => !p || p.startsWith(".")) || name.includes("\0")) return null;
    try {
      const realDir = fs.realpathSync(dir);
      const real = fs.realpathSync(path.resolve(realDir, name));
      const rel = path.relative(realDir, real);
      if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return null;
      return fs.statSync(real).isFile() ? real : null;
    } catch { return null; }
  }

  runtime(res, name) {
    if (name !== "lesson.css" && name !== "lesson.js") return this.send(res, 404, "text/plain", "Not found");
    return this.send(res, 200, TYPES[path.extname(name)], fs.readFileSync(path.join(this.media, name)));
  }

  add(req, res, chat, self) {
    if (req.headers.origin !== `http://${self}`) return this.send(res, 403, "text/plain", "Forbidden");
    return new Promise((resolve) => {
      let size = 0; const chunks = [];
      req.on("data", (c) => { size += c.length; if (size > MAX_ADD) { req.destroy(); resolve(); } else chunks.push(c); });
      req.on("end", () => {
        let item = null;
        try { item = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { /* not JSON */ }
        if (!item || typeof item !== "object" || !String(item.text || item.concept || "").trim()) { this.send(res, 400, "text/plain", "Nothing to add"); resolve(); return; }
        const clean = { text: clip(item.text, MAX_TEXT).trim(), concept: clip(item.concept, 120).trim(), title: clip(item.title, 120).trim(),
          slide: Number.isInteger(item.slide) && item.slide > 0 && item.slide < 1000 ? item.slide : null };
        Promise.resolve(this.onAdd(chat, clean)).then((ok) => { this.send(res, ok === false ? 404 : 200, "application/json", JSON.stringify({ ok: ok !== false })); resolve(); },
          () => { this.send(res, 500, "application/json", "{\"ok\":false}"); resolve(); });
      });
    });
  }
}

module.exports = { LessonServer, inject, CSP };

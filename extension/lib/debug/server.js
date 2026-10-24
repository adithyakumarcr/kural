// Debug Mode's log endpoint: the AI adds temporary instrumentation (marked `kural-debug`) that sends JSON here while you
// reproduce a bug, and reads the log file afterwards to see which hypothesis the evidence supports. No vscode inside.
//
//   Address:  http://127.0.0.1:<port>/<token>/log. ONE server for every chat, started on the first session; only 127.0.0.1, a
//             random port, and a random 32-byte token per chat in the path (looked up by hash, timingSafeEqual).
//   Send:     POST a JSON object (or any text) of at most 16 KB. It is appended to the chat's file as one NDJSON line
//             {t: ISO time, ...data} (text → {t, message}). Answers 204. CORS is open for POST (a browser app on another
//             port can send); everything else is 404.
//   File:     privateTmp("debug")/<chat id>.ndjson, mode 0600, at most 5 MB (then the oldest half goes).

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { privateTmp } = require("../paths");

const MAX_BODY = 16 * 1024;
const MAX_FILE = 5 * 1024 * 1024;
const CHAT_ID = /^[A-Za-z0-9_-]{1,80}$/;
const sha = (s) => crypto.createHash("sha256").update(s).digest();
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Max-Age": "600" };

class DebugLogs {
  // dir(): the folder for the log files (default: a private temp folder per run).
  constructor({ dir = () => privateTmp("debug"), log = () => {} } = {}) {
    this.dir = dir; this.log = log;
    this.sessions = new Map();   // chat id → { token, hash, file }
    this.server = null; this.port = 0; this.starting = null;
  }

  start() {
    if (this.starting) return this.starting;
    this.starting = new Promise((resolve, reject) => {
      const s = http.createServer((req, res) => { try { this.handle(req, res); } catch (e) { this.log(`debug log server: ${e.message}`); this.send(res, 500, "Error"); } });
      s.on("error", (e) => { this.starting = null; reject(e); });
      s.listen(0, "127.0.0.1", () => { this.server = s; this.port = s.address().port; resolve(this.port); });
    });
    return this.starting;
  }

  // The chat's endpoint (made on first use). Starts the server; the address is complete once the port is known.
  async session(chatId) {
    if (!CHAT_ID.test(String(chatId))) throw new Error("bad chat id");
    await this.start();
    let s = this.sessions.get(chatId);
    if (!s) {
      const token = crypto.randomBytes(32).toString("hex");
      const file = path.join(this.dir(), `${chatId}.ndjson`);
      fs.writeFileSync(file, "", { mode: 0o600 });
      s = { token, hash: sha(token), file };
      this.sessions.set(chatId, s);
    }
    return { url: `http://127.0.0.1:${this.port}/${s.token}/log`, file: s.file, token: s.token };
  }

  // Empty the log (before the next try).
  clear(chatId) {
    const s = this.sessions.get(chatId);
    if (s) try { fs.writeFileSync(s.file, "", { mode: 0o600 }); } catch { /* gone */ }
  }

  // The chat is closed or deleted: its address stops working and its file goes.
  end(chatId) {
    const s = this.sessions.get(chatId);
    if (!s) return;
    this.sessions.delete(chatId);
    try { fs.rmSync(s.file, { force: true }); } catch { /* best effort */ }
  }

  stop() {
    for (const id of [...this.sessions.keys()]) this.end(id);
    if (this.server) {
      this.server.close();
      if (this.server.closeAllConnections) this.server.closeAllConnections();   // (a kept-alive connection would still answer)
    }
    this.server = null; this.starting = null; this.port = 0;
  }

  send(res, code, body = "", extra = {}) {
    res.writeHead(code, { "Content-Type": "text/plain", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...CORS, ...extra });
    res.end(body);
  }

  find(token) {
    const h = sha(token);
    for (const s of this.sessions.values()) if (crypto.timingSafeEqual(h, s.hash)) return s;
    return null;
  }

  handle(req, res) {
    const self = `127.0.0.1:${this.port}`;
    if (req.headers.host !== self) return this.send(res, 403, "Forbidden");
    const parts = new URL(req.url, `http://${self}`).pathname.split("/");
    const s = parts.length === 3 && parts[2] === "log" && /^[0-9a-f]{64}$/.test(parts[1]) ? this.find(parts[1]) : null;
    if (!s) return this.send(res, 404, "Not found");
    if (req.method === "OPTIONS") return this.send(res, 204);
    if (req.method !== "POST") return this.send(res, 405, "POST only", { Allow: "POST, OPTIONS" });
    let size = 0, over = false; const chunks = [];
    req.on("data", (c) => {
      if (over) return;
      size += c.length;
      // (Refused at once, the rest of the body read and dropped: closing the socket here could lose the answer.)
      if (size > MAX_BODY) { over = true; chunks.length = 0; this.send(res, 413, "Too large", { Connection: "close" }); } else chunks.push(c);
    });
    req.on("end", () => {
      if (over) return;
      const text = Buffer.concat(chunks).toString("utf8").trim();
      if (!text) return this.send(res, 400, "Nothing to log");
      let data;
      try { data = JSON.parse(text); } catch { data = null; }
      const entry = data && typeof data === "object" && !Array.isArray(data) ? data : { message: data === null ? text : data };
      try { this.append(s, { ...entry, t: new Date().toISOString() }); } catch (e) { this.log(`debug log: ${e.message}`); return this.send(res, 500, "Error"); }
      this.send(res, 204);
    });
    req.on("error", () => {});
  }

  // One line at the end; over the cap, the oldest half of the file goes first (cut at a line).
  append(s, entry) {
    const line = JSON.stringify({ t: entry.t, ...entry }) + "\n";
    let size = 0;
    try { size = fs.statSync(s.file).size; } catch { /* made again below */ }
    if (size + line.length > MAX_FILE) {
      const old = fs.readFileSync(s.file);
      const from = old.indexOf(0x0a, Math.floor(old.length / 2));
      fs.writeFileSync(s.file, from < 0 ? Buffer.alloc(0) : old.subarray(from + 1), { mode: 0o600 });
    }
    fs.appendFileSync(s.file, line, { mode: 0o600 });
  }
}

module.exports = { DebugLogs, MAX_BODY, MAX_FILE };

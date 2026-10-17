// Where the browser tools' calls (browser-mcp.js, started by Claude Code / Codex for a chat) come into Kural. No vscode here.
//
// Like the device tools (lib/devices/bridge.js): a private local socket (a Unix socket only you can open; a named pipe on
// Windows), and a random token per chat, which each call must carry, so one chat can't drive the browser for another.
// handle(session, tool, args) → { text, image?, isError? } does the work (control.js, with the chat's ask).

const net = require("net");
const os = require("os");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const IS_WIN = process.platform === "win32";
const MCP = path.join(__dirname, "browser-mcp.js");
const NAME = "kural_browser";   // the MCP server's name: its tools are mcp__kural_browser__click etc.
const TOOLS = ["tabs", "open", "navigate", "snapshot", "click", "type", "press", "select", "upload", "drag", "scroll", "screenshot", "wait", "dialog"];

class Bridge {
  constructor(handle) {
    this.handle = handle;
    this.sessions = new Map();   // token → { chat, ask, cwd }
    this.server = null;
    this.where = null;
  }

  start() {
    if (this.server) return this.where;
    const id = crypto.randomBytes(8).toString("hex");
    this.where = IS_WIN ? `\\\\.\\pipe\\kural-browser-${id}` : path.join(os.tmpdir(), `kural-browser-${id}.sock`);
    this.server = net.createServer((c) => this.connection(c));
    this.server.on("error", () => {});
    const old = process.umask(0o077);   // the socket: only you can open it
    try { this.server.listen(this.where); } finally { process.umask(old); }
    return this.where;
  }

  stop() {
    if (this.server) { try { this.server.close(); } catch { /* closed */ } this.server = null; }
    if (!IS_WIN && this.where) { try { fs.unlinkSync(this.where); } catch { /* gone */ } }
    this.sessions.clear();
  }

  // A chat's AI gets the browser tools: its token, and the MCP server to give its program.
  //   ask(request) → Promise<{ allow, message? }>: the chat's decision (lib/chat approveBrowser). cwd: the project.
  session({ chat, ask, cwd }) {
    this.start();
    const token = crypto.randomBytes(24).toString("hex");
    this.sessions.set(token, { chat, ask, cwd });
    return { token, server: { command: process.execPath, args: [MCP],
      env: { ELECTRON_RUN_AS_NODE: "1", KURAL_BROWSER_SOCKET: this.where, KURAL_BROWSER_TOKEN: token } } };
  }
  end(token) { this.sessions.delete(token); }

  connection(c) {
    let buf = "";
    c.setEncoding("utf8");
    c.on("error", () => {});
    c.on("data", (d) => {
      buf += d;
      const i = buf.indexOf("\n");
      if (i < 0) { if (buf.length > 1024 * 1024) c.destroy(); return; }
      let req; try { req = JSON.parse(buf.slice(0, i)); } catch { req = null; }
      buf = "";
      this.call(req).then((r) => { try { c.end(JSON.stringify(r) + "\n"); } catch { /* closed */ } },
        (e) => { try { c.end(JSON.stringify({ text: e.message, isError: true }) + "\n"); } catch { /* closed */ } });
    });
  }

  async call(req) {
    const s = req && this.sessions.get(String(req.token || ""));
    if (!s) return { text: "This chat can't use the browser (any more): its answer was stopped, or the chat was closed.", isError: true };
    const tool = String(req.tool || "");
    if (!TOOLS.includes(tool)) return { text: `Unknown tool ${tool}.`, isError: true };
    const args = req.args && typeof req.args === "object" && !Array.isArray(req.args) ? req.args : {};
    return this.handle(s, tool, args);
  }
}

module.exports = { Bridge, MCP, NAME, TOOLS };

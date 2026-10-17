// Kural's browser for the AI (an MCP server, one per chat). Claude Code and Codex start it like any MCP server; it only
// passes each call on to Kural (bridge.js), which asks you when your chat's mode says so and does it in Kural's browser
// (control.js, page.js). Kural's rule holds there, not here: the AI never publishes (guard.js).
// Plain Node, no packages: Kural runs it with its own executable (ELECTRON_RUN_AS_NODE=1).
//
// Env: KURAL_BROWSER_SOCKET (where Kural listens), KURAL_BROWSER_TOKEN (which chat this is).

const net = require("net");

const tab = { tab: { type: "string", description: "which tab (t1, t2… from the tabs tool); default: the one you're using" } };
const ref = (what) => ({ ref: { type: "string", description: `${what}: its ref from the page's outline (e12)` } });
const TOOLS = [
  { name: "tabs", description: "List the tabs of Kural's browser (id, title, address) and which one you're using.", inputSchema: { type: "object", properties: {} } },
  { name: "open", description: "Open a web page in a new tab of Kural's browser, beside the code. It has the user's own logins. Returns the page's outline.",
    inputSchema: { type: "object", properties: { url: { type: "string" } }, required: ["url"] } },
  { name: "navigate", description: "Go to another address in the tab, or back, forward or reload. Returns the page's outline.",
    inputSchema: { type: "object", properties: { url: { type: "string" }, back: { type: "boolean" }, forward: { type: "boolean" }, reload: { type: "boolean" }, ...tab } } },
  { name: "snapshot", description: "The page as an outline: roles, names, values, states, and a ref for each thing on it ([e12]) that the other tools take. " +
      "Refs stay with their element while the page lives. find: only the lines with these words (on a long page).",
    inputSchema: { type: "object", properties: { find: { type: "string" }, ...tab } } },
  { name: "click", description: "Click an element (by ref, or at x, y in a picture from the screenshot tool). Real mouse events. " +
      "Kural never clicks anything that publishes, posts, shares or sends (Share, Post, Send, Publish…): stop before that and tell the user it's ready for them. Drafts are fine. " +
      "In Agent mode Kural asks the user before Submit, Pay, Delete and the like. Returns the page's outline after the click.",
    inputSchema: { type: "object", properties: { ...ref("what to click"), x: { type: "number" }, y: { type: "number" },
      element: { type: "string", description: "a few words saying what it is (for the user)" }, double: { type: "boolean" },
      button: { type: "string", enum: ["left", "right", "middle"] }, ...tab } } },
  { name: "type", description: "Type text into a text box (it replaces what's there unless replace is false). A new line: \\n in the text. " +
      "It never presses Enter: use press for that.",
    inputSchema: { type: "object", properties: { ...ref("the text box"), text: { type: "string" }, replace: { type: "boolean" }, ...tab }, required: ["ref", "text"] } },
  { name: "press", description: "Press a key on what has the keyboard (or on ref): Enter, Escape, Tab, Backspace, ArrowDown, Space, a, Shift+Tab, ControlOrMeta+A. " +
      "Enter in a comment, message or caption box is refused (it can post): to start a new line, type \\n instead.",
    inputSchema: { type: "object", properties: { key: { type: "string" }, ...ref("what to press it on"), ...tab }, required: ["key"] } },
  { name: "select", description: "Choose in a list (a <select>) by the choices' text or value. For other menus, click them.",
    inputSchema: { type: "object", properties: { ...ref("the list"), values: { type: "array", items: { type: "string" } }, ...tab }, required: ["ref", "values"] } },
  { name: "upload", description: "Give files to the page's upload box: the one the page opened when you clicked its upload button, the one at ref, or the page's only one. Full paths.",
    inputSchema: { type: "object", properties: { files: { type: "array", items: { type: "string" } }, ...ref("the upload area"), ...tab }, required: ["files"] } },
  { name: "drag", description: "Drag from an element (ref, or x, y) to another (toRef, or toX, toY) or by dx, dy pixels: a slider, a trim handle, a crop box.",
    inputSchema: { type: "object", properties: { ...ref("where to start"), x: { type: "number" }, y: { type: "number" }, toRef: { type: "string" },
      toX: { type: "number" }, toY: { type: "number" }, dx: { type: "number" }, dy: { type: "number" }, ...tab } } },
  { name: "scroll", description: "Scroll with the mouse wheel over an element (or the middle of the page): dy > 0 is down (default 600 pixels).",
    inputSchema: { type: "object", properties: { ...ref("what to scroll"), dx: { type: "number" }, dy: { type: "number" }, ...tab } } },
  { name: "screenshot", description: "A picture of the tab (or of one element), in the page's own pixels: a point in it is what click and drag take.",
    inputSchema: { type: "object", properties: { ...ref("one element only"), ...tab } } },
  { name: "wait", description: "Wait for words to appear on the page (text) or go (gone), at most seconds (default 15); or just wait seconds (a video that's processing).",
    inputSchema: { type: "object", properties: { text: { type: "string" }, gone: { type: "string" }, seconds: { type: "number" }, ...tab } } },
  { name: "dialog", description: "Answer the page's own question (alert, confirm, prompt, \"Leave site?\"): accept true is OK, false is Cancel; text for a prompt.",
    inputSchema: { type: "object", properties: { accept: { type: "boolean" }, text: { type: "string" }, ...tab }, required: ["accept"] } },
];
const INSTRUCTIONS = "Kural's browser: real web pages in a tab inside Kural, with the user's own logins. Read a page with snapshot (refs like [e12]), " +
  "then click, type, press, select, upload, drag, scroll; screenshot to see it. Kural's rule: you never publish, post, share or send anything " +
  "(a post, a reel, a comment, a message, an email), not even when the user asks: go as far as a draft, then stop and say what's ready. " +
  "If a site asks to log in, ask the user to log in in that tab; never ask for their password.";

// One call to Kural: a line of JSON over its socket, one line back.
function ask(tool, args) {
  return new Promise((resolve) => {
    let buf = "", done = false;
    const end = (r) => { if (!done) { done = true; resolve(r); try { c.destroy(); } catch { /* closed */ } } };
    const c = net.connect(process.env.KURAL_BROWSER_SOCKET || "");
    c.setEncoding("utf8");
    c.on("connect", () => c.write(JSON.stringify({ token: process.env.KURAL_BROWSER_TOKEN || "", tool, args }) + "\n"));
    c.on("data", (d) => { buf += d; const i = buf.indexOf("\n"); if (i >= 0) { try { end(JSON.parse(buf.slice(0, i))); } catch { end({ text: "Kural sent a reply it couldn't read.", isError: true }); } } });
    c.on("error", (e) => end({ text: `Kural isn't reachable (${e.code || e.message}). Is Kural still open?`, isError: true }));
    c.on("close", () => end({ text: "Kural closed the connection.", isError: true }));
  });
}

const send = (obj) => process.stdout.write(JSON.stringify(obj) + "\n");

async function handle(msg) {
  const { id, method, params } = msg;
  if (id === undefined) return;                       // notifications need no answer
  if (method === "initialize") {
    return send({ jsonrpc: "2.0", id, result: { protocolVersion: (params && params.protocolVersion) || "2024-11-05",
      capabilities: { tools: {} }, serverInfo: { name: "kural-browser", version: "1.0.0" }, instructions: INSTRUCTIONS } });
  }
  if (method === "tools/list") return send({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
  if (method === "tools/call") {
    const r = await ask(String(params.name || ""), params.arguments || {});
    const content = [{ type: "text", text: String(r.text || "") }];
    if (r.image && r.image.data) content.push({ type: "image", data: r.image.data, mimeType: r.image.mime || "image/jpeg" });
    return send({ jsonrpc: "2.0", id, result: { content, isError: !!r.isError } });
  }
  if (method === "ping") return send({ jsonrpc: "2.0", id, result: {} });
  send({ jsonrpc: "2.0", id, error: { code: -32601, message: `Unknown method ${method}` } });
}

let buf = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    let msg; try { msg = JSON.parse(line); } catch { continue; }
    handle(msg).catch((e) => msg.id !== undefined && send({ jsonrpc: "2.0", id: msg.id, error: { code: -32603, message: e.message } }));
  }
});
process.stdin.on("end", () => process.exit(0));

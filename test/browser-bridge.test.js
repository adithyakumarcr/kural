// The AI's way into Kural's browser: the MCP server Claude Code / Codex start (extension/lib/browser/browser-mcp.js), the
// private socket and per-chat token (bridge.js), and the controller's own decisions (control.js) with a stand-in for VS
// Code's browser API. The page itself is test/browser-page.live.js (a real Chrome).
const assert = require("assert");
const fs = require("fs"), os = require("os"), path = require("path");
const { spawn } = require("child_process");
const Module = require("module");

const shown = [];
let browserTabs = [], active = null, opened = [];
const vscode = {
  window: {
    get browserTabs() { return browserTabs; }, get activeBrowserTab() { return active; },
    openBrowserTab: async (url) => { const t = { url, title: "New", startCDPSession: async () => { throw new Error("no CDP here"); } }; browserTabs.push(t); opened.push(url); return t; },
    onDidCloseBrowserTab: () => ({ dispose() {} }), showWarningMessage: (m) => shown.push(m), tabGroups: { all: [] },
  },
  workspace: { getConfiguration: () => ({ get: () => undefined }) }, commands: { executeCommand: async () => {} },
  ViewColumn: { Beside: -2 }, Uri: { from: (x) => x, parse: (u) => ({ toString: () => u }) },
};
const load = Module._load;
Module._load = function (r, ...a) { return r === "vscode" ? vscode : load.call(this, r, ...a); };
const { Bridge, TOOLS, NAME } = require("../extension/lib/browser/bridge");
const { BrowserControl, siteOf } = require("../extension/lib/browser/control");
const { Stop } = require("../extension/lib/browser/page");

let failed = 0;
const check = async (name, fn) => { try { await fn(); console.log("ok  ", name); } catch (e) { failed++; console.error("FAIL", name, e.stack); } };

// Talk MCP (one JSON object per line) to a relay process.
function mcp(server) {
  const p = spawn(process.execPath, server.args, { env: { ...process.env, ...server.env } });
  let buf = "", id = 0;
  const waiting = new Map();
  p.stdout.setEncoding("utf8");
  p.stdout.on("data", (d) => { buf += d; let i; while ((i = buf.indexOf("\n")) >= 0) { const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1); const w = waiting.get(m.id); if (w) { waiting.delete(m.id); w(m); } } });
  return { call: (method, params) => new Promise((r) => { const n = ++id; waiting.set(n, r); p.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: n, method, params }) + "\n"); }), close: () => p.kill() };
}

(async () => {
  await check("the relay: tools, the rule in its instructions, calls with the chat's token, pictures", async () => {
    const calls = [];
    const bridge = new Bridge(async (s, tool, args) => {
      calls.push({ chat: s.chat, tool, args, cwd: s.cwd });
      if (tool === "screenshot") return { text: "a picture", image: { data: "/9j/AAAA", mime: "image/jpeg" } };
      if (tool === "click") return { text: "Kural stopped this: \"Share\" publishes", isError: true };
      return { text: `did ${tool}` };
    });
    const s = bridge.session({ chat: "c1", ask: async () => ({ allow: true }), cwd: "/proj" });
    assert.strictEqual(s.server.command, process.execPath);
    assert.strictEqual(s.server.env.ELECTRON_RUN_AS_NODE, "1");
    const m = mcp(s.server);
    try {
      const init = await m.call("initialize", { protocolVersion: "2025-06-18" });
      assert.ok(/never publish, post, share or send anything/.test(init.result.instructions), init.result.instructions);
      const list = (await m.call("tools/list", {})).result.tools;
      assert.deepStrictEqual(list.map((t) => t.name), TOOLS);
      for (const t of list) assert.ok(t.description && t.inputSchema && t.inputSchema.type === "object", t.name);
      assert.ok(/never clicks anything that publishes/.test(list.find((t) => t.name === "click").description));
      const r = await m.call("tools/call", { name: "type", arguments: { ref: "e3", text: "hi" } });
      assert.deepStrictEqual(r.result, { content: [{ type: "text", text: "did type" }], isError: false });
      assert.deepStrictEqual(calls[0], { chat: "c1", tool: "type", args: { ref: "e3", text: "hi" }, cwd: "/proj" });
      const pic = await m.call("tools/call", { name: "screenshot", arguments: {} });
      assert.deepStrictEqual(pic.result.content[1], { type: "image", data: "/9j/AAAA", mimeType: "image/jpeg" });
      const no = await m.call("tools/call", { name: "click", arguments: { ref: "e8" } });
      assert.ok(no.result.isError && /publishes/.test(no.result.content[0].text));
      const unknown = await m.call("tools/call", { name: "evaluate", arguments: { code: "document.forms[0].submit()" } });
      assert.ok(unknown.result.isError && /Unknown tool/.test(unknown.result.content[0].text));
      // The chat stopped: its token no longer works.
      bridge.end(s.token);
      const gone = await m.call("tools/call", { name: "tabs", arguments: {} });
      assert.ok(gone.result.isError && /can't use the browser/.test(gone.result.content[0].text));
      assert.strictEqual(calls.length, 3);
    } finally { m.close(); bridge.stop(); }
    assert.strictEqual(NAME, "kural_browser");
  });

  await check("another chat's token, or none, gets nothing", async () => {
    const bridge = new Bridge(async () => ({ text: "did it" }));
    bridge.session({ chat: "a", ask: async () => ({ allow: true }) });
    assert.ok((await bridge.call({ token: "guess", tool: "tabs", args: {} })).isError);
    assert.ok((await bridge.call({ tool: "tabs" })).isError);
    assert.ok((await bridge.call(null)).isError);
    bridge.stop();
    if (process.platform !== "win32") assert.ok(!fs.existsSync(bridge.where || "/nonexistent"), "the socket file is gone");
  });

  const ctl = new BrowserControl({ subscriptions: [] });
  ctl.register();
  const fakePage = { ran: [], snapshot: async () => "Page \"X\" · https://www.instagram.com/\n\n- button \"Next\" [e1]",
    click: async (a) => { fakePage.ran.push(["click", a]); return "Clicked button \"Next\"."; },
    upload: async (a) => { fakePage.ran.push(["upload", a]); return "Chose clip.mp4 for the page."; },
    screenshot: async () => ({ data: "/9j/BBBB", mime: "image/jpeg", width: 800, height: 600 }), ready: async () => {} };
  ctl.attach = async () => ({ page: fakePage, holders: new Set(), queue: Promise.resolve(), cdp: { close() {} } });

  await check("tabs: named t1, t2… for the AI; which one it uses", async () => {
    const ig = { url: "https://www.instagram.com/", title: "Instagram" }, local = { url: "http://localhost:3000/", title: "My app" };
    browserTabs = [ig, local]; active = local;
    const t = (await ctl.call("c1", "tabs", {})).text;
    assert.ok(/t\d+ "Instagram" · https:\/\/www\.instagram\.com\//.test(t) && /"My app" · http:\/\/localhost:3000\/ \(in front\)/.test(t), t);
    await ctl.call("c1", "snapshot", { tab: ctl.idOf(ig) });
    assert.ok(/"Instagram" .* \(you're using this one\)/.test((await ctl.call("c1", "tabs", {})).text));
    const none = await ctl.call("c1", "snapshot", { tab: "t99" });
    assert.ok(none.isError && /no browser tab t99/.test(none.text), none.text);
  });

  await check("every page tool asks the chat about the site first; a no is the AI's answer", async () => {
    const asked = [];
    const ask = async (req) => { asked.push(req); return req.kind === "site" && req.site === "instagram.com" && !req.readOnly ? { allow: false, message: "Ask mode only reads pages." } : { allow: true }; };
    const r = await ctl.call("c2", "click", { ref: "e1", tab: ctl.idOf(browserTabs[0]) }, ask);
    assert.ok(r.isError && r.text === "Ask mode only reads pages.", r.text);
    assert.deepStrictEqual(asked[0], { kind: "site", site: "instagram.com", url: "https://www.instagram.com/", tool: "click", readOnly: false });
    const read = await ctl.call("c2", "snapshot", {}, ask);
    assert.ok(!read.isError && /button "Next"/.test(read.text) && asked[1].readOnly === true);
    assert.strictEqual(fakePage.ran.length, 0, "nothing was clicked");
  });

  await check("open: web addresses only; the new tab's site is asked about first", async () => {
    const asked = [];
    for (const bad of ["file:///etc/passwd", "javascript:alert(1)", "vscode://x"]) {
      const r = await ctl.call("c3", "open", { url: bad }, async (q) => { asked.push(q); return { allow: true }; });
      assert.ok(r.isError && /web addresses only/.test(r.text), bad);
    }
    assert.strictEqual(asked.length, 0);
    const no = await ctl.call("c3", "open", { url: "example.com" }, async (q) => { asked.push(q); return { allow: false }; });
    assert.ok(no.isError && opened.length === 0 && asked[0].site === "example.com" && asked[0].readOnly === true);
    const yes = await ctl.call("c3", "open", { url: "https://www.instagram.com/" }, async () => ({ allow: true }));
    assert.ok(!yes.isError && /Opened https:\/\/www\.instagram\.com\/ in a new tab, t\d+/.test(yes.text) && opened[0] === "https://www.instagram.com/", yes.text);
  });

  await check("upload: real files only, each asked about (outside the project: the chat decides)", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kural-upload-"));
    fs.writeFileSync(path.join(dir, "clip.mp4"), "x");
    const asked = [];
    const ask = async (q) => { asked.push(q); return q.kind === "upload" ? { allow: false, message: "Skipped." } : { allow: true }; };
    const missing = await ctl.call("c4", "upload", { files: ["nope.mp4"] }, ask, dir);
    assert.ok(missing.isError && /There's no file .*nope\.mp4/.test(missing.text));
    const r = await ctl.call("c4", "upload", { files: ["clip.mp4"] }, ask, dir);
    assert.ok(r.isError && r.text === "Skipped.");
    assert.deepStrictEqual(asked.find((q) => q.kind === "upload").files, [path.join(dir, "clip.mp4")]);
    const ok = await ctl.call("c4", "upload", { files: [path.join(dir, "clip.mp4")] }, async () => ({ allow: true }), "/");
    assert.ok(!ok.isError && fakePage.ran.some(([w, a]) => w === "upload" && a.files[0] === path.join(dir, "clip.mp4")));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  await check("a picture goes to the AI and into a private file", async () => {
    const r = await ctl.call("c1", "screenshot", {});
    assert.ok(r.image && r.image.data === "/9j/BBBB" && /800×600 in the page's own pixels/.test(r.text), r.text);
    const file = /Saved as (.+\.jpg)\./.exec(r.text)[1];
    assert.strictEqual(fs.readFileSync(file, "base64"), "/9j/BBBB");
    if (process.platform !== "win32") assert.strictEqual(fs.statSync(file).mode & 0o777, 0o600);
  });

  await check("Kural's rule and the network stop reach the AI", async () => {
    fakePage.click = async () => { throw new Stop("Kural stopped this: \"Share\" publishes on instagram.com"); };
    const r = await ctl.call("c1", "click", { ref: "e8" });
    assert.ok(r.isError && /publishes on instagram\.com/.test(r.text));
    // A request that publishes, stopped in the network: said with the next result, and shown to you.
    const a = { note: null };
    ctl.blocked(browserTabs[0], a, { what: "publishing a post, reel or story", site: "Instagram" }, "https://www.instagram.com/api/v1/media/configure_to_clips/?x=1");
    assert.ok(/Kural stopped a request .* publishing a post, reel or story on Instagram/.test(a.note));
    assert.ok(shown.some((m) => /Kural stopped publishing a post, reel or story on Instagram/.test(m)), shown.join("\n"));
  });

  await check("siteOf", () => {
    assert.strictEqual(siteOf("https://www.instagram.com/reels/"), "instagram.com");
    assert.strictEqual(siteOf("http://localhost:3000/x"), "localhost:3000");
    assert.strictEqual(siteOf("about:blank"), "");
    assert.strictEqual(siteOf("file:///etc/passwd"), "");
  });

  console.log(failed ? `\n${failed} failed` : "\nAll passed.");
  process.exit(failed ? 1 : 0);
})();

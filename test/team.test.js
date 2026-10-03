// The agent team's message board (extension/lib/chat/team-mcp.js): messages, and nobody waiting forever.
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const assert = require("assert");

const file = path.join(os.tmpdir(), `kural-team-test-${process.pid}.json`);
fs.writeFileSync(file, JSON.stringify({ round: 1, finished: [] }));

function board() {
  const p = spawn(process.execPath, [path.join(__dirname, "..", "extension", "lib", "chat", "team-mcp.js")],
    { env: { ...process.env, KURAL_TEAM: "Rachel,Ross,Monica", KURAL_TEAM_FILE: file } });
  const waiters = new Map();
  let buf = "", id = 0;
  p.stdout.on("data", (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) { const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1); const w = waiters.get(m.id); if (w) w(m); }
  });
  const send = (method, params) => new Promise((resolve) => { const n = ++id; waiters.set(n, resolve); p.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: n, method, params }) + "\n"); });
  const call = (name, args) => send("tools/call", { name, arguments: args }).then((m) => m.result.content[0].text);
  return { p, send, call };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  let fail = 0;
  const check = async (name, fn) => { try { await fn(); console.log("ok  ", name); } catch (e) { fail++; console.log("FAIL", name, e.message); } };
  const b = board();
  await b.send("initialize", { protocolVersion: "2025-06-18" });

  await check("tools", async () => assert.deepStrictEqual((await b.send("tools/list")).result.tools.map((t) => t.name), ["post", "finish", "read"]));
  await check("a waiting read gets a later post", async () => {
    const r = b.call("read", { name: "Ross", wait_seconds: 5 });
    await sleep(100); await b.call("post", { from: "Rachel", to: "Ross", message: "It's 42" });
    assert.strictEqual(await r, "[rachel → ross] It's 42");
  });
  await check("messages for someone else aren't delivered", async () => assert.strictEqual(await b.call("read", { name: "Monica" }), "No new messages."));
  await check("a message to all reaches everyone", async () => {
    await b.call("post", { from: "Lead", to: "all", message: "Wrap up" });
    assert.strictEqual(await b.call("read", { name: "monica" }), "[lead → everyone] Wrap up");
  });
  await check("waiting for a teammate who finishes: woken at once", async () => {
    await b.call("read", { name: "Ross" });                         // catch up first
    const t0 = Date.now();
    const r = b.call("read", { name: "Ross", wait_seconds: 30 });
    await sleep(100); await b.call("finish", { name: "Rachel", final_position: "Use spaces." });
    const got = await r;
    assert.ok(Date.now() - t0 < 2000, "should not wait 30 s");
    assert.ok(/FINISHED\. Final position: Use spaces\./.test(got), got);
  });
  await check("nobody answering: told to stop waiting after two empty waits", async () => {
    await b.call("read", { name: "Monica" });
    assert.strictEqual(await b.call("read", { name: "Monica", wait_seconds: 1 }), "No messages in 1 s.");
    assert.ok(/Stop waiting/.test(await b.call("read", { name: "Monica", wait_seconds: 1 })));
  });
  await check("an agent that ended without finish (Kural tells the board): waiters woken", async () => {
    const t0 = Date.now();
    const r = b.call("read", { name: "Ross", wait_seconds: 30 });
    fs.writeFileSync(file, JSON.stringify({ round: 1, finished: ["monica"] }));
    const got = await r;
    assert.ok(Date.now() - t0 < 3000, "should not wait 30 s");
    assert.ok(/monica/.test(got) && /Everyone else has finished/.test(got), got);
  });
  await check("everyone else finished: read returns at once", async () => {
    const t0 = Date.now();
    assert.ok(/Everyone else has finished/.test(await b.call("read", { name: "Ross", wait_seconds: 30 })));
    assert.ok(Date.now() - t0 < 1000);
  });
  await check("a new question starts afresh", async () => {
    fs.writeFileSync(file, JSON.stringify({ round: 2, finished: [] }));
    await sleep(1300);
    const r = b.call("read", { name: "Ross", wait_seconds: 1 });
    assert.strictEqual(await r, "No messages in 1 s.");
  });

  await check("only started agents count: not waiting for developers the PM never started", async () => {
    fs.writeFileSync(file, JSON.stringify({ round: 3, finished: [], started: ["rachel", "ross"] }));
    await sleep(1300);
    const r = b.call("read", { name: "Ross", wait_seconds: 30 });
    await sleep(100); await b.call("finish", { name: "Rachel", final_position: "PLAN: ..." });
    assert.ok(/Everyone else has finished/.test(await r));   // Monica is on the team list but never started
  });
  await check("waiting for a teammate who's still busy doesn't count as 'nobody answers'", async () => {
    fs.writeFileSync(file, JSON.stringify({ round: 4, finished: [], started: ["monica", "ross"], busy: ["monica"] }));
    await sleep(1300);
    await b.call("read", { name: "Ross" });
    for (let i = 0; i < 3; i++) assert.strictEqual(await b.call("read", { name: "Ross", wait_seconds: 1 }), "No messages in 1 s.");
    fs.writeFileSync(file, JSON.stringify({ round: 4, finished: [], started: ["monica", "ross"], busy: [] }));
    await sleep(1300);
    await b.call("read", { name: "Ross", wait_seconds: 1 });
    assert.ok(/Stop waiting/.test(await b.call("read", { name: "Ross", wait_seconds: 1 })));
  });

  b.p.kill();
  fs.rmSync(file, { force: true });
  console.log(fail ? `team board: ${fail} FAILED` : "team board: ALL PASS");
  process.exit(fail ? 1 : 0);
})();

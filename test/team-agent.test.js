const assert = require("assert"), fs = require("fs"), os = require("os"), path = require("path");
const { TeamAgent, assignments } = require("../extension/lib/chat/team-agent");
const { CodexAgent } = require("../extension/lib/ai/codex");
const { AgyAgent } = require("../extension/lib/ai/agy");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kural-team-agent-"));
let failed = 0;
const check = async (name, fn) => { try { await fn(); console.log("ok  ", name); } catch (e) { failed++; console.error("FAIL", name, e.stack); } };
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const timeout = (p) => { let timer; return Promise.race([p, new Promise((_, reject) => timer = setTimeout(() => reject(new Error("team timed out")), 8000))]).finally(() => clearTimeout(timer)); };
const members = [{ name: "Monica", id: "developer" }, { name: "Chandler", id: "developer" }];
const plan = (same = false) => JSON.stringify({ summary: "Build two independent parts", assignments: members.map((m, i) => ({ name: m.name, files: [same ? "a.js" : `${i}.js`], task: `Implement part ${i}` })) });

function fixture(config = { size: 4, roles: ["researcher", "architect", "developer", "tester"], style: "split" }, behavior = {}) {
  const events = [], jobs = [], permits = [], answers = [], kills = [];
  let resolve;
  const done = () => timeout(new Promise((r) => resolve = r));
  const make = (opts, h) => {
    if (behavior.makeThrow && /Rachel$/.test(opts.name)) throw new Error("The provider could not start");
    const job = { opts, h, killed: false }; jobs.push(job);
    return { start: () => true, send: async (content) => {
      job.content = content;
      if (behavior.hang && /Form your own position/.test(opts.appendSystemPrompt)) return;
      await pause(3);
      if (job.killed) return;
      if (behavior.fail && /Form your own position/.test(opts.appendSystemPrompt) && /Rachel$/.test(opts.name)) { h.onMessage({ type: "result", is_error: true, result: "quota exceeded" }); return; }
      const build = /Build your assigned part|Address the Tester's/.test(opts.appendSystemPrompt);
      if (build) {
        const perm = await h.onPermission({ tool_name: "Write", tool_use_id: "file", input: { file_path: path.join(dir, /Chandler$/.test(opts.name) ? "1.js" : "0.js") } });
        assert.ok(perm.allow);
      }
      if (job.killed) return;
      let result = /KURAL_TEAM_PLAN/.test(opts.appendSystemPrompt) ? plan(behavior.overlap)
        : /KURAL_TEAM_REVIEW/.test(opts.appendSystemPrompt) ? (behavior.reviewCount++ === 0 ? "Fix the edge case in part 0" : "OK: checked the fixes")
        : /final answer from the team's reports/.test(opts.appendSystemPrompt) ? "Team finished with evidence." : `${opts.name}: report with file:line evidence`;
      // The same underlying ids from different processes must not collide in the chat.
      h.onMessage({ type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id: "read", name: "Read", input: { file_path: "README.md" } }] } });
      h.onMessage({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "read", content: "read completed" }] } });
      h.onMessage({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: result } } });
      h.onMessage({ type: "result", is_error: false, result });
    }, kill: () => { job.killed = true; kills.push(opts.name); } };
  };
  behavior.reviewCount = 0;
  const agent = new TeamAgent({ name: "chat", bin: process.execPath, cwd: dir, model: "test", mode: "agent", store: dir,
    appendSystemPrompt: "Keep the API. ", teamConfig: config }, {
    onMessage: (m) => { events.push(m); if (m.type === "result" && resolve) resolve(m); },
    onPermission: async (req) => {
      permits.push(req);
      if (req.tool_name === "AskUserQuestion") {
        answers.push(req.input.questions[0].question);
        if (behavior.waitApproval) await behavior.waitApproval;
        return { allow: true, updatedInput: { answers: { [req.input.questions[0].question]: behavior.answer || "Go ahead" } } };
      }
      return { allow: true };
    } }, make);
  assert.ok(agent.start());
  return { agent, events, jobs, permits, answers, kills, done };
}

(async () => {
  await check("overlapping, outside-project and duplicate assignments cannot build concurrently", () => {
    assert.strictEqual(assignments(plan(), members, dir).tasks.length, 2);
    assert.strictEqual(assignments(plan(true), members, dir).tasks.length, 1);
    const outside = JSON.stringify({ summary: "x", assignments: [{ name: "Monica", files: ["../outside.js"], task: "x" }] });
    assert.strictEqual(assignments(outside, members, dir).tasks[0].files, null);
    assert.strictEqual(assignments("plain plan", members, dir).tasks.length, 1);
    assert.strictEqual(assignments('{"summary":"Already completed","assignments":[]}', members, dir).tasks.length, 0);
  });
  await check("project teams plan, wait for approval, build separate files, then review and fix findings", async () => {
    let approve; const f = fixture(undefined, { waitApproval: new Promise((r) => approve = r) });
    const result = f.done(); f.agent.send("Implement two features, keep the API.");
    await pause(30);
    assert.strictEqual(f.answers.length, 1);
    assert.ok(!f.jobs.some((j) => /Build your assigned/.test(j.opts.appendSystemPrompt)));
    approve(); const r = await result;
    assert.strictEqual(r.is_error, false); assert.strictEqual(r.kural_team_complete, true);
    assert.strictEqual(f.jobs.filter((j) => /Build your assigned/.test(j.opts.appendSystemPrompt)).length, 2);
    assert.strictEqual(f.jobs.filter((j) => /KURAL_TEAM_REVIEW/.test(j.opts.appendSystemPrompt)).length, 2);
    assert.strictEqual(f.jobs.filter((j) => /Address the Tester's/.test(j.opts.appendSystemPrompt)).length, 2);
    assert.ok(f.permits.filter((p) => p.tool_name === "Write").every((p) => p.agent_id && p.tool_use_id !== "file"));
    const ids = f.events.filter((m) => m.type === "assistant" && m.parent_tool_use_id).flatMap((m) => m.message.content).filter((b) => b.name === "Read").map((b) => b.id);
    assert.strictEqual(new Set(ids).size, ids.length);
    assert.ok(f.jobs.every((j) => j.killed), "no idle provider processes remain after the team finishes");
    f.agent.kill();
  });
  await check("Stop and Change the plan never start developers", async () => {
    for (const answer of ["Stop", "Change the plan"]) {
      const f = fixture(undefined, { answer }); const done = f.done(); f.agent.send("Implement two features"); await done;
      assert.ok(!f.jobs.some((j) => /Build your assigned/.test(j.opts.appendSystemPrompt))); f.agent.kill();
    }
  });
  await check("Plan and Ask never ask to build or start developers", async () => {
    for (const mode of ["plan", "ask"]) {
      const f = fixture(); f.agent.mode = mode; const done = f.done(); f.agent.send("Implement two features"); await done;
      assert.strictEqual(f.answers.length, 0); assert.ok(!f.jobs.some((j) => /Build your assigned/.test(j.opts.appendSystemPrompt)));
      assert.ok(f.jobs.every((j) => ["plan", "ask"].includes(j.opts.mode))); f.agent.kill();
    }
  });
  await check("discussions form independent views, then receive peer reports, retaining attached pictures", async () => {
    const f = fixture({ size: 2, roles: [], style: "discuss" }); const done = f.done();
    const content = [{ type: "text", text: "Compare these designs." }, { type: "image", source: { type: "base64", media_type: "image/png", data: "aW1hZ2U=" } }];
    f.agent.send(content); await done;
    const first = f.jobs.filter((j) => /Form your own position/.test(j.opts.appendSystemPrompt));
    assert.strictEqual(first.length, 2); assert.ok(first.every((j) => !/Team reports so far/.test(j.opts.appendSystemPrompt)));
    const second = f.jobs.filter((j) => /Answer the other positions/.test(j.opts.appendSystemPrompt));
    assert.strictEqual(second.length, 2); assert.ok(second.every((j) => /Rachel|Ross/.test(j.opts.appendSystemPrompt) && /Team reports so far/.test(j.opts.appendSystemPrompt)));
    assert.ok(f.jobs.every((j) => j.opts.mode === "ask" && j.content === content)); f.agent.kill();
  });
  await check("queued requests echo as separate turns and saved team history survives a restart", async () => {
    const f = fixture({ size: 2, roles: [], style: "discuss" }); const done = f.done();
    f.agent.send("First task, no deployment."); f.agent.send("Second task."); await done;
    const second = f.done(); await second;
    assert.strictEqual(f.events.filter((m) => m.type === "user" && m.isReplay).length, 2);
    const session = f.agent.sessionId; f.agent.kill();
    const resumed = new TeamAgent({ ...f.agent.opts, sessionId: null, resume: session }, {}, () => {});
    assert.strictEqual(resumed.history.filter((m) => m.role === "user").length, 2);
    assert.match(JSON.stringify(resumed.history), /no deployment/); resumed.kill();
  });
  await check("long team history is compacted with a readable complete record; earlier images are retained", async () => {
    const f = fixture({ size: 2, roles: [], style: "discuss" }); f.agent.opts.handoffChars = 2000;
    const pic = { type: "image", source: { type: "base64", media_type: "image/png", data: "cGljdHVyZQ==" } };
    f.agent.history = [{ role: "user", text: "Keep the API. " + "source ".repeat(4000), media: [pic] },
      { role: "assistant", text: "First result. " + "findings ".repeat(4000), reports: [] }];
    const done = f.done(); f.agent.send("Continue."); await done;
    assert.ok(f.jobs.every((j) => /compacted/.test(j.opts.appendSystemPrompt) && !/saved at undefined/.test(j.opts.appendSystemPrompt)));
    assert.ok(f.jobs.every((j) => j.content.some((b) => b.type === "image" && b.source.data === pic.source.data)));
    const recorded = JSON.parse(fs.readFileSync(path.join(f.agent.directory, "handoff", "history.json"), "utf8"));
    assert.strictEqual(recorded.format, "kural-visible-history-v1");
    assert.ok(fs.readFileSync(path.join(f.agent.directory, "handoff", "history.json"), "utf8").split("\n").every((s) => s.length < 2000));
    f.agent.kill();
  });
  await check("interrupt cancels all members; Finish now suppresses further rounds and concludes", async () => {
    for (const finish of [false, true]) {
      const f = fixture({ size: 2, roles: [], style: "discuss" }, { hang: true }); const done = f.done(); f.agent.send("Discuss");
      await pause(10); finish ? f.agent.finishTeam() : f.agent.interrupt(); const r = await done;
      assert.strictEqual(r.is_error, !finish); if (!finish) assert.strictEqual(r.subtype, "error_during_execution");
      assert.ok(f.jobs.every((j) => j.killed)); assert.ok(!f.jobs.some((j) => /Answer the other positions/.test(j.opts.appendSystemPrompt))); f.agent.kill();
    }
  });
  await check("a failed member stops its teammates and produces one error result", async () => {
    const f = fixture({ size: 2, roles: [], style: "discuss" }, { fail: true }); const done = f.done(); f.agent.send("Discuss");
    const r = await done; assert.strictEqual(r.is_error, true); assert.match(r.result, /quota/);
    await pause(15); assert.strictEqual(f.events.filter((m) => m.type === "result").length, 1); assert.ok(f.jobs.every((j) => j.killed)); f.agent.kill();
  });
  await check("a provider startup exception ends every member's card", async () => {
    const f = fixture({ size: 2, roles: [], style: "discuss" }, { makeThrow: true }); const done = f.done(); f.agent.send("Discuss");
    const r = await done; assert.strictEqual(r.is_error, true); assert.match(r.result, /could not start/);
    assert.strictEqual(f.events.filter((m) => m.subtype === "task_started").length, f.events.filter((m) => m.subtype === "task_notification").length);
    f.agent.kill();
  });
  await check("stopping one member lets the rest finish and skips that member's next phase", async () => {
    const f = fixture({ size: 2, roles: [], style: "discuss" }); const done = f.done(); f.agent.send("Discuss");
    const started = f.events.find((m) => m.subtype === "task_started");
    await f.agent.request({ subtype: "stop_task", task_id: started.task_id });
    const r = await done; assert.strictEqual(r.is_error, false);
    assert.strictEqual(f.jobs.filter((j) => /Answer the other positions/.test(j.opts.appendSystemPrompt)).length, 1);
    assert.ok(f.events.some((m) => m.subtype === "task_notification" && m.status === "stopped")); f.agent.kill();
  });
  await check("Codex and Gemini teams work through the real adapters and their CLI fakes", async () => {
    for (const [name, Agent, fake] of [["codex", CodexAgent, "fake-codex.js"], ["agy", AgyAgent, "fake-agy.js"]]) {
      const events = []; let resolve;
      const done = timeout(new Promise((r) => resolve = r));
      const agent = new TeamAgent({ name: "chat", bin: path.join(__dirname, fake), cwd: dir, store: dir, model: "default", mode: "ask", effort: "low",
        env: { FAKE_CODEX_USAGE: "1", FAKE_CODEX_STATE: "ok", FAKE_AGY_STATE: "ok", FAKE_CODEX_FILE: path.join(dir, "codex-state"), FAKE_AGY_FILE: path.join(dir, "agy-state") },
        appendSystemPrompt: "Keep the API.", teamConfig: { size: 2, roles: [], style: "discuss" } }, {
        onMessage: (m) => { events.push(m); if (m.type === "result") resolve(m); }, onPermission: async () => ({ allow: true }) }, (o, h) => new Agent(o, h));
      try {
        assert.ok(agent.start()); agent.send("hello team"); const r = await done;
        assert.strictEqual(r.is_error, false, name + ": " + r.result);
        assert.strictEqual(events.filter((m) => m.subtype === "task_started").length, 4);
        assert.strictEqual(events.filter((m) => m.subtype === "task_notification").length, 4);
        assert.ok(events.some((m) => m.type === "kural_usage"));
      } finally { agent.kill(); }
    }
  });
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(failed ? `team-agent: ${failed} FAILED` : "team-agent: ALL PASS"); process.exitCode = failed ? 1 : 0;
})();

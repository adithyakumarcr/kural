// Parallel agents (lib/split): the plan, the git work on a real repository, and the whole run with stand-in agents.
const assert = require("assert"), fs = require("fs"), os = require("os"), path = require("path");
const { spawnSync } = require("child_process");
const { parsePlan, shownFiles, MAX_AGENTS } = require("../extension/lib/split/plan");
const { Worktrees } = require("../extension/lib/split/worktrees");
const { SplitAgent } = require("../extension/lib/split/agent");

let failed = 0;
const check = async (name, fn) => { try { await fn(); console.log("ok  ", name); } catch (e) { failed++; console.error("FAIL", name, e.stack); } };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kural-split-"));
const GIT = spawnSync("git", ["--version"]).status === 0 ? "git" : null;
const git = (cwd, ...args) => {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
};
let n = 0;
// A repository with two committed files, one uncommitted change and one untracked file.
function repo() {
  const dir = path.join(tmp, `repo-${++n}`);
  fs.mkdirSync(dir);
  git(dir, "init", "-q");
  fs.writeFileSync(path.join(dir, "a.txt"), "one\ntwo\nthree\nfour\nfive\nsix\nseven\n");
  fs.writeFileSync(path.join(dir, "b.txt"), "b\n");
  fs.writeFileSync(path.join(dir, ".gitignore"), "ignored/\n");
  git(dir, "add", "-A"); git(dir, "commit", "-q", "-m", "first");
  fs.writeFileSync(path.join(dir, "b.txt"), "b changed by you\n");     // not committed
  fs.writeFileSync(path.join(dir, "new.txt"), "untracked\n");          // not even added
  fs.mkdirSync(path.join(dir, "ignored")); fs.writeFileSync(path.join(dir, "ignored", "x"), "x");
  return dir;
}

(async () => {
  await check("the plan: JSON (also in a fence or with words around it), at most four tasks, one task when it can't be read", () => {
    const tasks = Array.from({ length: 6 }, (_, i) => ({ title: `T${i}`, task: `do ${i}`, files: [`f${i}.js`] }));
    assert.strictEqual(parsePlan("```json\n" + JSON.stringify({ summary: "s", tasks }) + "\n```", "req").tasks.length, MAX_AGENTS);
    assert.strictEqual(parsePlan(`Here it is: ${JSON.stringify({ summary: "s", tasks: tasks.slice(0, 2) })} done`, "req").tasks.length, 2);
    assert.deepStrictEqual(parsePlan("no plan", "the request").tasks, [{ title: "The request", task: "the request", files: [] }]);
    assert.deepStrictEqual(parsePlan(JSON.stringify({ tasks: [{ title: "", task: "x" }, { title: "ok", task: "" }] }), "r").tasks.length, 1);
    assert.deepStrictEqual(shownFiles(["src/a.js", "../outside.js", "/etc/passwd", "./b.js"], "/p"), [path.join("src", "a.js"), "b.js"]);
  });

  if (!GIT) { console.log("skip  git tests: no git here"); process.exit(failed ? 1 : 0); }

  await check("worktrees: the snapshot is your files as they are (uncommitted and untracked too, not ignored), your index untouched", async () => {
    const dir = repo();
    const statusBefore = git(dir, "status", "--porcelain"), head = git(dir, "rev-parse", "HEAD");
    const t = await Worktrees.open(GIT, dir, path.join(tmp, `trees-${n}`));
    const base = await t.snapshot();
    assert.strictEqual(git(dir, "status", "--porcelain"), statusBefore);
    assert.strictEqual(git(dir, "rev-parse", "HEAD"), head);
    const w = await t.add("agent-1", base, dir);
    assert.strictEqual(fs.readFileSync(path.join(w.dir, "b.txt"), "utf8"), "b changed by you\n");
    assert.ok(fs.existsSync(path.join(w.dir, "new.txt")));
    assert.ok(!fs.existsSync(path.join(w.dir, "ignored")));
    assert.strictEqual(await t.commit(w.dir, "nothing"), null);
    await t.close();
    assert.strictEqual(git(dir, "worktree", "list").split("\n").length, 1);
    assert.strictEqual(git(dir, "branch", "--list").split("\n").length, 1);   // (no branch made)
  });

  await check("worktrees: two agents' commits merge; a conflict stays for the lead, and is undone when markers are left", async () => {
    const dir = repo();
    const t = await Worktrees.open(GIT, dir, path.join(tmp, `trees-${n}`));
    const base = await t.snapshot();
    const [w1, w2, w3] = [await t.add("a1", base, dir), await t.add("a2", base, dir), await t.add("a3", base, dir)];
    fs.writeFileSync(path.join(w1.dir, "a.txt"), "ONE\ntwo\nthree\nfour\nfive\nsix\nseven\n");
    fs.writeFileSync(path.join(w2.dir, "a.txt"), "one\ntwo\nthree\nfour\nfive\nsix\nSEVEN\n");
    fs.writeFileSync(path.join(w2.dir, "c.txt"), "made by agent 2\n");
    fs.writeFileSync(path.join(w3.dir, "a.txt"), "uno\ntwo\nthree\nfour\nfive\nsix\nseven\n");
    const [s1, s2, s3] = [await t.commit(w1.dir, "1"), await t.commit(w2.dir, "2"), await t.commit(w3.dir, "3")];
    const m = await t.add("merge", base, dir);
    assert.deepStrictEqual((await t.merge(m.dir, s1, "m1")).conflicts, []);
    assert.deepStrictEqual((await t.merge(m.dir, s2, "m2")).conflicts, []);
    assert.deepStrictEqual((await t.merge(m.dir, s3, "m3")).conflicts, ["a.txt"]);
    assert.strictEqual(await t.finishMerge(m.dir, ["a.txt"]), false);   // (markers left: undone)
    const final = await t.head(m.dir);
    const changes = await t.changes(base, final);
    assert.deepStrictEqual(changes.map((c) => c.rel).sort(), ["a.txt", "c.txt"]);
    const a = changes.find((c) => c.rel === "a.txt");
    assert.strictEqual(String(a.final), "ONE\ntwo\nthree\nfour\nfive\nsix\nSEVEN\n");
    assert.strictEqual(changes.find((c) => c.rel === "c.txt").base, null);
    // A file you changed meanwhile: merged with yours.
    const merged = await t.mergeFile(Buffer.from("one\ntwo\nthree\nFOUR\nfive\nsix\nseven\n"), a.base, a.final);
    assert.strictEqual(String(merged.content), "ONE\ntwo\nthree\nFOUR\nfive\nsix\nSEVEN\n");
    assert.strictEqual(merged.conflict, false);
    const clash = await t.mergeFile(Buffer.from("1\ntwo\nthree\nfour\nfive\nsix\nseven\n"), a.base, a.final);
    assert.ok(clash.conflict && /<<<<<<< your version/.test(String(clash.content)));
    await t.close();
  });

  await check("worktrees: not a repository → null", async () => {
    const plain = path.join(tmp, "plain"); fs.mkdirSync(plain);
    assert.strictEqual(await Worktrees.open(GIT, plain, path.join(tmp, "trees-plain")), null);
    assert.strictEqual(await Worktrees.open(null, plain, path.join(tmp, "trees-plain")), null);
  });

  // ---------- the whole run, with stand-in agents ----------
  // Each stand-in answers by what it was asked: the plan, an agent's task, resolving a conflict, the final check, or
  // the request itself. plan: the lead's plan; work(n, cwd, h): what agent n does in its copy.
  function setup({ plan, work = async () => {}, mode = "agent", onPlan, permit = () => ({ allow: true }), dir = repo() } = {}) {
    const events = [], perms = [], runs = [], kills = [];
    const make = (model, opts, h) => {
      const run = { model, opts, h }; runs.push(run);
      return { start: () => true, kill: () => kills.push(opts.name), send: async (content) => {
        const text = typeof content === "string" ? content : content[0].text;
        run.prompt = text;
        await new Promise((r) => setTimeout(r, 5));
        const say = (t) => { h.onMessage({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: t } } }); h.onMessage({ type: "result", result: t }); };
        if (/Kural can split this request/.test(text)) {
          run.kind = "plan";
          run.planPerm = await h.onPermission({ tool_name: "Bash", input: { command: "ls" } });
          return say(JSON.stringify(plan));
        }
        const agent = /You are agent (\d+) of/.exec(text);
        if (agent) { run.kind = `agent ${agent[1]}`; try { await work(+agent[1], opts.cwd, h); } catch (e) { return h.onMessage({ type: "result", is_error: true, result: e.message }); } return say(`agent ${agent[1]} done`); }
        if (/Resolve them in this folder/.test(text)) { run.kind = "resolve"; return say("resolved"); }
        if (/The agents' work is now in the project/.test(text)) { run.kind = "verify"; return say("All done."); }
        run.kind = "alone"; return say("Did it myself.");
      } };
    };
    let resolve;
    const result = new Promise((r) => { resolve = r; });
    const h = { onMessage: (m) => { events.push(m); if (m.type === "result") resolve(m); },
      onPermission: async (req) => { perms.push(req); return permit(req); },
      onPlan: onPlan || (async (p) => ({ go: true, models: p.tasks.map(() => "haiku") })) };
    const agent = new SplitAgent({ name: "chat t", model: "opus", mode, cwd: dir, appendSystemPrompt: "CHAT RULES", split: { workers: "haiku", instructions: "BUILD RULES", dir: path.join(tmp, `split-${n}`),
      models: [{ id: "opus", label: "Opus" }, { id: "sonnet", label: "Sonnet" }, { id: "haiku", label: "Haiku" }], history: () => "<earlier_conversation>hi</earlier_conversation>" } }, h, make);
    agent.start(); agent.send("Build both parts");
    return { dir, events, perms, runs, kills, result, agent };
  }
  const twoTasks = { summary: "Two parts", tasks: [{ title: "Part one", task: "Change a.txt's first line", files: ["a.txt"] }, { title: "Part two", task: "Add c.txt", files: ["c.txt"] }] };
  const writeIn = (cwd, file, text) => fs.writeFileSync(path.join(cwd, file), text);

  await check("a run: the lead plans read only, you pick the models, the agents work at once, Kural merges and applies, the lead checks", async () => {
    let planSeen;
    const s = setup({ plan: twoTasks, onPlan: async (p) => { planSeen = p; return { go: true, models: ["haiku", "sonnet"] }; }, work: async (k, cwd, h) => {
      // An agent's edit in its own copy needs no card; one in your project is refused.
      assert.deepStrictEqual(await h.onPermission({ tool_name: "Write", input: { file_path: path.join(cwd, "x") } }), { allow: true });
      assert.strictEqual((await h.onPermission({ tool_name: "Edit", input: { file_path: path.join(s.dir, "a.txt") } })).allow, false);
      if (k === 1) writeIn(cwd, "a.txt", "ONE\ntwo\nthree\nfour\nfive\nsix\nseven\n");
      else writeIn(cwd, "c.txt", "new\n");
      fs.rmSync(path.join(cwd, "x"), { force: true });
    } });
    const head = git(s.dir, "rev-parse", "HEAD");
    const end = await s.result;
    assert.strictEqual(end.is_error, false, end.result);
    assert.strictEqual(end.result, "All done.");
    assert.ok(end.kural_split_complete);
    assert.deepStrictEqual(planSeen.tasks.map((t) => [t.title, t.files, t.model]), [["Part one", ["a.txt"], "haiku"], ["Part two", ["c.txt"], "haiku"]]);
    assert.strictEqual(s.runs.find((r) => r.kind === "plan").planPerm.allow, true);
    assert.strictEqual(s.perms.find((p) => p.input.command === "ls").mode, "plan");   // (the plan is decided in Plan mode)
    assert.deepStrictEqual(s.runs.filter((r) => /^agent/.test(r.kind)).map((r) => r.model).sort(), ["haiku", "sonnet"]);
    assert.ok(s.runs.filter((r) => /^agent/.test(r.kind)).every((r) => r.opts.cwd !== s.dir && !r.opts.persist));
    // (The agents get only what they need to build; the lead keeps the chat's whole instructions.)
    assert.ok(s.runs.filter((r) => /^agent/.test(r.kind)).every((r) => r.opts.appendSystemPrompt === "BUILD RULES"));
    assert.ok(["plan", "verify"].every((k) => s.runs.find((r) => r.kind === k).opts.appendSystemPrompt === "CHAT RULES"));
    assert.ok(/earlier_conversation/.test(s.runs.find((r) => r.kind === "plan").prompt));
    // Your project: both agents' work in, your own uncommitted change kept, HEAD and branches untouched, no worktree left.
    assert.strictEqual(fs.readFileSync(path.join(s.dir, "a.txt"), "utf8").split("\n")[0], "ONE");
    assert.strictEqual(fs.readFileSync(path.join(s.dir, "c.txt"), "utf8"), "new\n");
    assert.strictEqual(fs.readFileSync(path.join(s.dir, "b.txt"), "utf8"), "b changed by you\n");
    assert.strictEqual(git(s.dir, "rev-parse", "HEAD"), head);
    assert.strictEqual(git(s.dir, "worktree", "list").split("\n").length, 1);
    // Each file went through the chat's permission check (its checkpoint), and shows as a step.
    assert.deepStrictEqual(s.perms.filter((p) => p.tool_name === "Write" && !p.agent_id).map((p) => path.basename(p.input.file_path)).sort(), ["a.txt", "c.txt"]);
    const cards = s.events.filter((m) => m.type === "assistant" && m.message.content.some((b) => b.name === "Task")).map((m) => m.message.content[0].input);
    assert.deepStrictEqual(cards.map((c) => [c.description, c.kural_agent.label]), [["Part one", "Haiku"], ["Part two", "Sonnet"]]);
    assert.strictEqual(s.events.filter((m) => m.subtype === "task_notification" && m.status === "completed").length, 2);
    assert.ok(/Agent 1 \(Haiku\), "Part one"/.test(s.runs.find((r) => r.kind === "verify").prompt));
  });

  await check("a run: a file you changed while the agents worked is merged with yours", async () => {
    const s = setup({ plan: twoTasks, work: async (k, cwd) => {
      if (k === 1) { writeIn(cwd, "a.txt", "ONE\ntwo\nthree\nfour\nfive\nsix\nseven\n"); writeIn(s.dir, "a.txt", "one\ntwo\nthree\nfour\nfive\nsix\nSEVEN (you)\n"); }
      else writeIn(cwd, "c.txt", "new\n");
    } });
    const end = await s.result;
    assert.strictEqual(end.is_error, false, end.result);
    assert.strictEqual(fs.readFileSync(path.join(s.dir, "a.txt"), "utf8"), "ONE\ntwo\nthree\nfour\nfive\nsix\nSEVEN (you)\n");
  });

  await check("a run: a file you said no to isn't changed, and the lead is told", async () => {
    const s = setup({ plan: twoTasks, permit: (req) => ({ allow: !(req.tool_name === "Write" && /c\.txt$/.test(req.input.file_path) && !req.agent_id) }),
      work: async (k, cwd) => writeIn(cwd, k === 1 ? "a.txt" : "c.txt", "agent\n") });
    await s.result;
    assert.ok(!fs.existsSync(path.join(s.dir, "c.txt")));
    assert.ok(/The user chose not to apply: c\.txt/.test(s.runs.find((r) => r.kind === "verify").prompt));
  });

  await check("a run: two agents changing the same lines → the lead resolves it in the merge copy", async () => {
    const s = setup({ plan: twoTasks, work: async (k, cwd) => writeIn(cwd, "a.txt", `agent ${k}\ntwo\nthree\nfour\nfive\nsix\nseven\n`) });
    const end = await s.result;
    assert.strictEqual(end.is_error, false, end.result);
    const resolve = s.runs.find((r) => r.kind === "resolve");
    assert.ok(resolve && /a\.txt/.test(resolve.prompt) && resolve.opts.cwd !== s.dir);
    // (The stand-in left the markers: agent 2's work wasn't merged, and the lead is told.)
    assert.strictEqual(fs.readFileSync(path.join(s.dir, "a.txt"), "utf8").split("\n")[0], "agent 1");
    assert.ok(/Not merged: agent 2/.test(s.runs.find((r) => r.kind === "verify").prompt));
  });

  await check("a run: one agent fails, the other's work still comes in", async () => {
    const s = setup({ plan: twoTasks, work: async (k, cwd) => { if (k === 2) throw new Error("quota exceeded"); writeIn(cwd, "a.txt", "agent 1\n"); } });
    const end = await s.result;
    assert.strictEqual(end.is_error, false, end.result);
    assert.strictEqual(fs.readFileSync(path.join(s.dir, "a.txt"), "utf8"), "agent 1\n");
    assert.ok(/Not merged: agent 2 \(Part two\): quota exceeded/.test(s.runs.find((r) => r.kind === "verify").prompt));
    assert.ok(s.events.some((m) => m.subtype === "task_notification" && m.status === "failed"));
  });

  await check("one task, or not a Git repository: the lead does it itself, in your project", async () => {
    const one = setup({ plan: { summary: "small", tasks: [{ title: "Fix", task: "fix it" }] } });
    assert.strictEqual((await one.result).result, "Did it myself.");
    assert.strictEqual(one.runs.find((r) => r.kind === "alone").opts.cwd, one.dir);
    const plain = path.join(tmp, "plain-run"); fs.mkdirSync(plain);
    const s = setup({ plan: twoTasks, dir: plain });
    assert.strictEqual((await s.result).result, "Did it myself.");
    assert.ok(s.events.some((m) => m.type === "assistant" && m.message.content.some((b) => b.name === "Kural" && /Git repository/.test(b.input.detail))));
  });

  await check("the plan card: Stop changes nothing; a change request plans again with it; Auto doesn't ask", async () => {
    const stop = setup({ plan: twoTasks, onPlan: async () => ({ stop: true }) });
    assert.ok(/nothing was changed/.test((await stop.result).result));
    assert.ok(!stop.runs.some((r) => /^agent/.test(r.kind)));
    let asked = 0;
    const change = setup({ plan: twoTasks, onPlan: async () => (++asked === 1 ? { change: "only one agent for docs" } : { stop: true }) });
    await change.result;
    assert.ok(/The user wants the plan changed: only one agent for docs/.test(change.runs.filter((r) => r.kind === "plan")[1].prompt));
    const auto = setup({ plan: twoTasks, mode: "auto", onPlan: async () => { throw new Error("asked in Auto"); }, work: async (k, cwd) => writeIn(cwd, `${k}.txt`, "x") });
    assert.strictEqual((await auto.result).is_error, false);
    assert.ok(auto.runs.filter((r) => /^agent/.test(r.kind)).every((r) => r.model === "haiku"));   // (your default)
  });

  await check("Stop while the agents work: your files stay as they were, no worktree is left", async () => {
    let release;
    const s = setup({ plan: twoTasks, work: async (k, cwd) => { writeIn(cwd, "a.txt", "agent\n"); await new Promise((r) => { release = r; }); } });
    while (!s.runs.some((r) => r.kind === "agent 2")) await new Promise((r) => setTimeout(r, 5));
    const before = fs.readFileSync(path.join(s.dir, "a.txt"), "utf8");
    s.agent.interrupt();
    release();
    const end = await s.result;
    assert.strictEqual(end.is_error, true);
    assert.strictEqual(fs.readFileSync(path.join(s.dir, "a.txt"), "utf8"), before);
    assert.strictEqual(git(s.dir, "worktree", "list").split("\n").length, 1);
  });

  // The agents and the final check through Kural's real Codex adapter (lib/ai/codex.js) and the stand-in codex program:
  // its file changes come to Kural as permission requests, from inside each agent's worktree.
  await check("with the real Codex adapter: each agent's edits stay in its worktree, then come into your project once", async () => {
    if (process.platform === "win32") return;
    process.env.FAKE_CODEX_FILE = path.join(tmp, "codex-state");
    const codex = require("../extension/lib/ai/codex");
    const dir = path.join(tmp, "codex-repo"); fs.mkdirSync(dir);
    git(dir, "init", "-q"); fs.writeFileSync(path.join(dir, "notes.txt"), "one\nthree\n"); git(dir, "add", "-A"); git(dir, "commit", "-q", "-m", "first");
    const plan = { summary: "Both agents edit the notes", tasks: [{ title: "Notes", task: "edit notes" }, { title: "Notes again", task: "edit notes" }] };
    const cwds = [], perms = [];
    const make = (model, opts, h) => {
      if (opts.mode === "plan") return { start: () => true, kill: () => {}, send: () => setImmediate(() => h.onMessage({ type: "result", result: JSON.stringify(plan) })) };
      cwds.push(opts.cwd);
      return new codex.CodexAgent({ name: opts.name, bin: path.join(__dirname, "fake-codex.js"), cwd: opts.cwd, mode: opts.mode, store: path.join(tmp, "codex-store") }, h);
    };
    const end = await new Promise((resolve) => {
      const agent = new SplitAgent({ name: "chat c", model: "codex:default", mode: "agent", cwd: dir,
        split: { workers: "codex:default", dir: path.join(tmp, "split-codex"), models: [{ id: "codex:default", label: "Codex" }] } },
        { onMessage: (m) => { if (m.type === "result") resolve(m); }, onPermission: async (req) => { perms.push(req); return { allow: true }; }, onPlan: async () => ({ go: true }) }, make);
      agent.start(); agent.send("Edit the notes twice");
    });
    assert.strictEqual(end.is_error, false, end.result);
    assert.match(end.result, /You said:/);   // (the final check's answer)
    assert.strictEqual(fs.readFileSync(path.join(dir, "notes.txt"), "utf8"), "one\ntwo\nthree\n");
    assert.strictEqual(fs.readFileSync(path.join(dir, "new.txt"), "utf8"), "fresh file\n");
    assert.strictEqual(cwds.filter((c) => c !== dir).length, 2);   // (two agents in their worktrees; the check in your project)
    // The agents' own edits never reached the chat; the merged files did, once each.
    assert.deepStrictEqual(perms.filter((p) => p.tool_name === "Write").map((p) => path.basename(p.input.file_path)).sort(), ["new.txt", "notes.txt"]);
    assert.strictEqual(git(dir, "worktree", "list").split("\n").length, 1);
  });

  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* (Windows: a git that just ended can still hold a folder) */ }
  process.exit(failed ? 1 : 0);
})();

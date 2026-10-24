// Parallel agents' git work (no vscode): each agent works in its own git worktree, and Kural merges their work and
// brings the result into your project. Nothing here touches your branch, your index or your files:
//   snapshot()   your working tree as it is now (tracked + untracked, not ignored) as a commit, through a temporary index
//   add(name)    a worktree of that snapshot for one agent (detached: no branch is made)
//   commit(dir)  what the agent changed there, as a commit (null: it changed nothing)
//   merge(dir, sha)  one agent's commit into the merge worktree: { conflicts: [files] }
//   changes(base, final)  the files that differ, with their content as checkout would write it (eol and filters applied)
//   mergeFile(current, base, final)  a 3-way merge of one file's content (for a file you changed while the agents worked)
// The commits only live in the repository's object store until git's own gc drops them; the worktrees are removed by
// close(). Hooks never run (an empty hooks folder) and commits are never signed: they are Kural's scratch work.
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");

const WHO = { GIT_AUTHOR_NAME: "Kural", GIT_AUTHOR_EMAIL: "kural@localhost", GIT_COMMITTER_NAME: "Kural", GIT_COMMITTER_EMAIL: "kural@localhost" };
const TIMEOUT = 5 * 60 * 1000;   // (a worktree of a big repository takes a while to check out)

class Worktrees {
  // git: the git program; dir: a private folder for the worktrees (lib/paths.js privateTmp).
  constructor(git, root, dir) {
    this.git = git; this.root = root; this.dir = dir; this.trees = [];
    this.hooks = fs.mkdtempSync(path.join(dir, "hooks-"));   // (empty: no hook of the repository runs)
  }

  // The repository `cwd` is in, or null (not one, or git isn't there).
  static async open(git, cwd, dir) {
    if (!git) return null;
    const r = await run(git, ["rev-parse", "--show-toplevel"], { cwd });
    if (!r.ok) return null;
    const root = r.out.trim();
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const w = new Worktrees(git, root, dir);
    await w.run(["worktree", "prune"]);   // (worktrees of an earlier run that was cut short)
    return w;
  }

  run(args, opts = {}) {
    return run(this.git, ["-c", `core.hooksPath=${this.hooks}`, "-c", "commit.gpgsign=false", ...args], { cwd: this.root, ...opts });
  }
  async must(args, opts) {
    const r = await this.run(args, opts);
    if (!r.ok) throw new Error(`git ${args[0]}: ${(r.err || r.out).trim().split("\n").pop() || `exit ${r.code}`}`);
    return r.out.trim();
  }

  // The working tree as a commit on top of HEAD (or a first commit in a repository without one).
  async snapshot() {
    const index = path.join(this.dir, `index-${process.pid}-${Date.now()}`);
    const env = { GIT_INDEX_FILE: index };
    try {
      const head = await this.run(["rev-parse", "--verify", "--quiet", "HEAD"]);
      if (head.ok) await this.must(["read-tree", "HEAD"], { env });
      await this.must(["add", "-A", "--", "."], { env });
      const tree = await this.must(["write-tree"], { env });
      return await this.must(["commit-tree", tree, ...(head.ok ? ["-p", head.out.trim()] : []), "-m", "Kural: your files when the agents started"]);
    } finally { fs.rmSync(index, { force: true }); }
  }

  // A worktree of `base` for one agent: { dir, cwd } (cwd: where the project folder is inside it).
  async add(name, base, cwd) {
    const dir = path.join(this.dir, name);
    await this.must(["worktree", "add", "--detach", "--force", dir, base]);
    this.trees.push(dir);
    // (git gives the repository's real path: /private/var/… on a Mac where you opened /var/…)
    return { dir, cwd: path.join(dir, path.relative(fs.realpathSync(this.root), fs.realpathSync(cwd))) };
  }

  // Everything the agent changed in its worktree as one commit; null when it changed nothing.
  async commit(dir, message) {
    await this.must(["-C", dir, "add", "-A", "--", "."]);
    const same = await this.run(["-C", dir, "diff", "--cached", "--quiet"]);
    if (same.ok) return null;
    await this.must(["-C", dir, "commit", "--no-verify", "-q", "-m", message]);
    return this.must(["-C", dir, "rev-parse", "HEAD"]);
  }

  // One agent's commit into the merge worktree. Conflicts stay in the files (with markers) for the lead to resolve.
  async merge(dir, sha, message) {
    const r = await this.run(["-C", dir, "merge", "--no-ff", "--no-verify", "--no-edit", "-m", message, sha]);
    if (r.ok) return { conflicts: [] };
    const conflicts = (await this.must(["-C", dir, "diff", "--name-only", "--diff-filter=U"])).split("\n").filter(Boolean);
    if (!conflicts.length) throw new Error(`git merge: ${(r.err || r.out).trim().split("\n").pop()}`);
    return { conflicts };
  }
  // After the lead resolved them: false when markers are left (then the merge is undone).
  async finishMerge(dir, files) {
    for (const f of files) {
      let text = "";
      try { text = fs.readFileSync(path.join(dir, f), "utf8"); } catch { /* deleted: resolved */ }
      if (/^(<{7}|>{7})( |$)/m.test(text)) { await this.run(["-C", dir, "merge", "--abort"]); return false; }
    }
    await this.must(["-C", dir, "add", "-A", "--", "."]);
    await this.must(["-C", dir, "commit", "--no-verify", "-q", "--no-edit"]);
    return true;
  }
  head(dir) { return this.must(["-C", dir, "rev-parse", "HEAD"]); }

  // The files that differ between two commits: [{ file (absolute, in your project), base, final (Buffers; null: no file),
  // executable }]. Symbolic links and submodules aren't brought over (skipped: true).
  async changes(base, final) {
    const out = [];
    const list = (await this.run(["diff", "--name-status", "--no-renames", "-z", base, final])).out.split("\0").filter(Boolean);
    for (let i = 0; i + 1 < list.length; i += 2) {
      const rel = list[i + 1];
      const mode = (await this.run(["ls-tree", final, "--", rel])).out.split(" ")[0] || (await this.run(["ls-tree", base, "--", rel])).out.split(" ")[0];
      const item = { rel, file: path.join(this.root, rel) };
      if (mode === "120000" || mode === "160000") { out.push({ ...item, skipped: true }); continue; }
      out.push({ ...item, base: await this.content(base, rel), final: await this.content(final, rel), executable: mode === "100755" });
    }
    return out;
  }
  // A file's content at a commit as checkout writes it (line endings, filters); null when it isn't there.
  async content(rev, rel) {
    const r = await this.run(["cat-file", "--filters", `${rev}:${rel}`], { buffer: true });
    return r.ok ? r.buf : null;
  }

  // current, base, final: Buffers (null: no file). { content, conflict } with git's merge markers on a conflict.
  async mergeFile(current, base, final) {
    const tmp = fs.mkdtempSync(path.join(this.dir, "merge-"));
    try {
      const f = (name, b) => { const p = path.join(tmp, name); fs.writeFileSync(p, b || ""); return p; };
      const r = await run(this.git, ["merge-file", "-p", "-L", "your version", "-L", "before", "-L", "the agents' version",
        f("current", current), f("base", base), f("final", final)], { cwd: tmp, buffer: true });
      if (r.code < 0 || r.code > 127) throw new Error(`git merge-file: ${r.err.trim()}`);
      return { content: r.buf, conflict: r.code > 0 };
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  }

  async close() {
    for (const dir of this.trees.splice(0)) await this.run(["worktree", "remove", "--force", "--force", dir]);
    await this.run(["worktree", "prune"]);
    fs.rmSync(this.hooks, { recursive: true, force: true });
  }
}

// One git command: { ok, code, out, err, buf }. Never throws; never asks for anything (no terminal prompt).
function run(git, args, { cwd, env, buffer = false, timeout = TIMEOUT } = {}) {
  return new Promise((resolve) => {
    execFile(git, args, { cwd, timeout, maxBuffer: 256 * 1024 * 1024, encoding: "buffer", windowsHide: true,
      env: { ...process.env, ...WHO, GIT_TERMINAL_PROMPT: "0", LC_ALL: "C", ...env } }, (e, stdout, stderr) => {
      const code = e ? (typeof e.code === "number" ? e.code : -1) : 0;
      resolve({ ok: !e, code, buf: stdout, out: buffer ? "" : String(stdout || ""), err: String(stderr || (e && !stderr ? e.message : "")) });
    });
  });
}

module.exports = { Worktrees, run };

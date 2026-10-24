// Parallel agents: what the lead and the agents are told, and how the lead's plan is read (no vscode).
const path = require("path");

const MAX_AGENTS = 4;

const PLAN = (max) => `Kural can split this request between up to ${max} agents that work at the same time, each in its own ` +
  `copy of the project; Kural merges their work afterwards. Plan the split, read only: look at the code first.\n` +
  `- Make a task only for work that doesn't wait on another task's result. Split by file or module, so two tasks rarely ` +
  `change the same file; give shared files (docs, changelogs, registries, a shared config) to one task.\n` +
  `- Each task is complete and self-contained: the agent sees only its task and the summary, not this conversation. ` +
  `Name the files, the behaviour, the conventions to follow and how to check it.\n` +
  `- A request that is small, a question, or that can't be split into independent parts is ONE task.\n` +
  `Answer with only this JSON, no other text: {"summary":"the approach in a few sentences", "tasks":[{"title":"a few ` +
  `words","task":"what to do, completely","files":["relative/path"]}]}`;

const WORKER = ({ n, count, title, task, summary, others, cwd }) => `You are agent ${n} of ${count}, working at the same time ` +
  `as the others. Kural gave you your own copy of the project (in ${cwd}) and merges every agent's copy when all are done.\n` +
  `The plan: ${summary}\nYour task, "${title}": ${task}\n` +
  (others.length ? `The other agents do (don't do their parts): ${others.join("; ")}.\n` : "") +
  `Rules: work only on your task, in your copy. Don't commit and don't change git history: Kural does that. ` +
  `Dependencies (node_modules and the like) aren't in your copy: don't install them; the lead runs the project's checks ` +
  `after the merge. End with a short report: what you changed (files), what you checked, and anything left open.`;

const RESOLVE = (n, files) => `Kural is merging agent ${n}'s work with the others' and git found conflicts in: ${files.join(", ")}. ` +
  `Resolve them in this folder: edit those files so both sides' intended changes are kept and no conflict markers ` +
  `(<<<<<<<, =======, >>>>>>>) are left. Don't change other files and don't run git. Report what you decided.`;

const VERIFY = ({ summary, reports, applied, conflicts, kept, skipped, declined, failed }) =>
  `The agents' work is now in the project. The plan was: ${summary}\n\nTheir reports:\n${reports.join("\n\n")}\n\n` +
  `Files changed: ${applied.length ? applied.join(", ") : "none"}.` +
  (conflicts.length ? `\nThe user changed these files while the agents worked, and both changes collided: ${conflicts.join(", ")}. ` +
    `They now have conflict markers; resolve them first.` : "") +
  (kept.length ? `\nThe user created or deleted these while the agents worked, so their version was kept and the agents' ` +
    `changes to them weren't brought over: ${kept.join(", ")}.` : "") +
  (skipped.length ? `\nNot brought over (symbolic links or submodules): ${skipped.join(", ")}.` : "") +
  (declined.length ? `\nThe user chose not to apply: ${declined.join(", ")}.` : "") +
  (failed.length ? `\nNot merged: ${failed.join("; ")}.` : "") +
  `\n\nCheck the combined result as the lead: read the changes, run the project's relevant checks (tests, build, lint), ` +
  `and fix what doesn't fit together. Then give the user the final answer: what each agent did (and with which model), ` +
  `what you checked and its result, and what is still open. Don't claim a check passed that you didn't run.`;

// The lead's plan → { summary, tasks: [{ title, task, files }] }. Not JSON, or no tasks: one task, the request itself.
function parsePlan(text, request, max = MAX_AGENTS) {
  const raw = String(text || "");
  let plan = null;
  for (const candidate of [raw.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, ""), (/\{[\s\S]*\}/.exec(raw) || [""])[0]]) {
    try { plan = JSON.parse(candidate); break; } catch { /* the next way */ }
  }
  const str = (s, n) => typeof s === "string" ? s.trim().slice(0, n) : "";
  const tasks = (plan && Array.isArray(plan.tasks) ? plan.tasks : [])
    .map((t) => t && { title: str(t.title, 80), task: str(t.task, 8000),
      files: Array.isArray(t.files) ? t.files.map((f) => str(f, 300)).filter(Boolean).slice(0, 40) : [] })
    .filter((t) => t && t.title && t.task).slice(0, max);
  const summary = str(plan && plan.summary, 2000);
  return tasks.length ? { summary, tasks } : { summary, tasks: [{ title: "The request", task: request, files: [] }] };
}

// Files from the plan, relative to the project and inside it (what the card shows); others are left out.
const shownFiles = (files, cwd) => files.map((f) => path.relative(cwd, path.resolve(cwd, f)))
  .filter((f) => f && !f.startsWith("..") && !path.isAbsolute(f));

module.exports = { MAX_AGENTS, PLAN, WORKER, RESOLVE, VERIFY, parsePlan, shownFiles };

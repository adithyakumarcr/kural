// Agent teams: who's on the team (names, roles), the lead's instructions (teamPrompt), and the team's message board
// (team-mcp.js, a tiny MCP server Claude Code starts). No vscode here.
const path = require("path");

// Agent team: one lead splits the work and runs N helpers at the same time.
// Agent team: the model you picked leads; it splits the work and runs N agents of the same
// model at once. The agents are named after the Friends cast and can message each other
// through a small shared board (lib/team-mcp.js).
const FRIENDS = ["Rachel", "Ross", "Monica", "Chandler", "Joey", "Phoebe"];
const TEAM_TOOLS = ["mcp__team__post", "mcp__team__read", "mcp__team__finish"];

// Roles you can give the agents in a team (pick several).
// Roles for agent teams. Each has its own name (Friends), so the same role is always the same person.
// The lead (the main Claude, the one you talk to) is the Project Manager. With "Split the work" the team works in
// phases: plan (Researcher, Architect) → your OK → build (1–3 Developers, the PM decides) → check (Tester).
const ROLES = [
  { id: "researcher", label: "Researcher", name: "Rachel", desc: "researches and plans",
    duty: "You research and plan. Search online (WebSearch, WebFetch: official docs, best practices, libraries, known " +
      "pitfalls) and look in the code where needed. Then write a plan proposal: the approach, the steps, what to use, the " +
      "risks, and your sources (links). Send it to the Architect (if there is one) and the lead. Back every claim with a " +
      "source or file:line. You don't change code." },
  { id: "architect", label: "Architect", name: "Ross", desc: "designs the solution",
    duty: "You are the Software Architect. Study the current architecture first: structure, patterns, modules and their " +
      "interfaces, conventions (quote file:line). Then decide the best solution for the request that fits this " +
      "architecture: which files change, new or changed interfaces and names, and how the work splits into independent " +
      "parts for developers. Review the Researcher's proposal against the real code: keep what fits, push back on what " +
      "doesn't, with reasons. Prefer the simplest design that solves it. You don't change code." },
  { id: "developer", label: "Developer", name: "Monica", desc: "builds it",
    duty: "You build. Implement exactly your part of the approved plan, only in your files, following the Architect's " +
      "design and the project's style. When your part is ready, tell the Tester (by name) what changed and where. Answer " +
      "every finding: fix it, or explain with evidence why not, and tell the Tester when it's done." },
  { id: "tester", label: "Tester", name: "Phoebe", desc: "checks code quality",
    duty: "You check every piece of code that gets written. Read the real changes (the diff), not the description. Check " +
      "code quality: correctness, readability, structure, naming, duplication, error handling, security, and whether it " +
      "follows the plan and the architecture. If the project has tests, run them; add a test for the new behaviour where " +
      "it makes sense. Send concrete findings (file:line, what's wrong, what to do) to the developer. Never just approve: " +
      "reply \"OK\" only when the code is good, and say what you checked." },
];
const DEVELOPERS = ["Monica", "Chandler", "Joey"];   // the PM starts 1–3 of them, as the work needs
const TEAM_STYLES = [
  { id: "split", label: "Split the work", hint: "work in parallel" },
  { id: "discuss", label: "Discuss & decide", hint: "talk it through, agree" },
];

// The team: who's who ("Rachel, the Researcher (researches and plans)"). With roles, each role has its own name;
// with "Split the work" the Developer role can be up to three people (the PM decides how many to start).
function teamMembers(n, roles, style = "split") {
  if (!roles.length) return FRIENDS.slice(0, n).map((name) => ({ name, role: null, desc: null }));
  const out = [];
  for (const r of ROLES.filter((x) => roles.includes(x.id))) {
    const names = r.id === "developer" && style !== "discuss" ? DEVELOPERS : [r.name];
    for (const name of names) out.push({ name, role: r.label, desc: r.desc, id: r.id });
  }
  // A discussion needs two: add someone without a role.
  if (style === "discuss" && out.length < 2) out.push({ name: FRIENDS.find((f) => !out.some((m) => m.name === f)), role: null, desc: null });
  return out;
}
const who = (m) => m.role ? `${m.name}, the ${m.role} (${m.desc})` : m.name;
const opening = (m, team) => `"You are ${m.name}${m.role ? `, the ${m.role}` : ""}, on a team with ` +
  `${team.filter((x) => x !== m).map((x) => x.role ? `${x.name} (${x.role})` : x.name).join(", ")} and the lead."`;
const BOARD = `The team can talk: tell each agent it has three tools, mcp__team__post (send a message to a teammate by name, to ` +
  `"lead", or to "all"), mcp__team__read (read its messages; wait_seconds waits for a reply) and mcp__team__finish (call ` +
  `it once, with its final position, right before it ends; teammates then stop waiting for it). Tell them too: never ` +
  `keep waiting for a teammate who has finished, and when mcp__team__read says to stop waiting, finish right away.`;
const brief = (m, team) => `${opening(m, team).slice(0, -1)}${m.role ? ` Your role — ${m.role}: ${ROLES.find((r) => r.label === m.role).duty}` : ""}"`;
const starts = (team) => `put the Task tool calls in ONE message, subagent_type "general-purpose". Begin each agent's Task prompt ` +
  `with its brief, word for word:\n${team.map((m) => `- ${m.name}: ${brief(m, team)}`).join("\n")}\n`;

function teamPrompt(n, roles = [], style = "split") {
  const team = teamMembers(n, roles, style);
  if (style === "discuss") {
    const first = team[0].name;
    return `\n\nYou moderate a discussion between ${team.length} agents: ${team.map(who).join("; ")}. The user wants a real debate ` +
      `where each agent argues from its own role, and then a decision. Copies of the same model tend to agree too fast; ` +
      `your rules exist to prevent that. Start all of them at once: ${starts(team)}Then add the full question and context, and these rules, word for word:\n` +
      `"1. First investigate on your own, from your role (read the code, run things if useful). Form your own position ` +
      `BEFORE reading your teammates' messages.\n` +
      `2. Round 1: post your own position to "all" with mcp__team__post: your claim, your evidence (file:line, output), and ` +
      `what would change your mind. Then read the others' positions with mcp__team__read (wait_seconds 90) until you ` +
      `have one from every teammate.\n` +
      `3. Next rounds: answer the others point by point from your role. Say what you disagree with and why, with ` +
      `evidence. Agreement must be earned: name the exact concern that was answered. Don't repeat yourself: add ` +
      `something new or concede a point explicitly. Wait for replies with mcp__team__read (wait_seconds 90).\n` +
      `4. At least two rounds before any decision; at most four. ${first} then posts to "all": "DECISION: … / Agreed by: … / ` +
      `Still disagrees: … (why)". If you couldn't agree, ${first} makes the best call and records the dissent honestly.\n` +
      `5. After the DECISION, don't wait for more messages: call mcp__team__finish with your final position (whether ` +
      `you agree with the decision, and why), then end with the same as your report.\n` +
      `6. Don't change files during the discussion` + (roles.includes("developer") ? ` (only if the user asked the team to ` +
        `also carry out the decision: the Developer does it after the DECISION)` : ``) + `."\n` +
      `${BOARD} Refer to the agents by name. Don't take part and don't post progress updates. When all have reported, give ` +
      `the user: the decision; each agent's final position in one line (name, role, agree or not, the main reason); the ` +
      `main point of disagreement and how it was settled; and any remaining dissent. Don't smooth over disagreement.`;
  }
  if (roles.length) return projectPrompt(team);
  return `\n\nYou lead a team of ${n} agents: ${team.map(who).join("; ")}. Your goal is to finish the user's task ` +
    `as FAST as possible by working in parallel. Split it into parts (by file or feature), so two agents never edit ` +
    `the same file. Start all of them at once: ${starts(team)}Then add a complete, self-contained description of its part (files, goal, constraints). ` +
    `For a part that is well-defined and mechanical (following an existing pattern, a rename, tests for a clear spec), ` +
    `start that agent with model "haiku": faster, and it saves the user's usage; keep your model for parts that need judgment.\n` +
    `${BOARD} Agents should use them whenever their work depends on each other — agree on shared names and interfaces, ask ` +
    `a question and wait for the answer, tell others when something they need is ready. You can use them too, as "lead".\n` +
    `Refer to the agents by name. Don't do their parts yourself. While they work, don't post progress updates; reply ` +
    `once, when all have reported back: check the results, fix gaps, and give the user a short summary. Only for a tiny ` +
    `task (one quick edit or a question) work alone.`;
}

// "Split the work" with roles: you lead it as the Project Manager, in phases.
function projectPrompt(team) {
  const planners = team.filter((m) => m.id === "researcher" || m.id === "architect");
  const devs = team.filter((m) => m.id === "developer");
  const tester = team.find((m) => m.id === "tester");
  const R = team.find((m) => m.id === "researcher"), A = team.find((m) => m.id === "architect");
  const names = (list) => list.map((m) => m.name).join(" and ");
  let step = 1;
  const out = [`\n\nYou are the Project Manager (PM), the lead of a project team. The user talks to you. Your team: ` +
    `${team.filter((m) => m.id !== "developer").map(who).concat(devs.length ? [`up to ${devs.length} Developers (${devs.map((m) => m.name).join(", ")}; you decide how many)`] : []).join("; ")}. ` +
    `The user picked this team on purpose: use every role, even for a small task. Work in these phases, in order:`];
  out.push(`${step++}. Requirements. Make sure you know what the user wants: scope, behaviour, constraints, and what "done" ` +
    `means. If something important is unclear and you can't find it out yourself (from the code, the files, the context), ` +
    `ask the user with AskUserQuestion (short options, your recommendation first) BEFORE you start anyone. Don't ask about ` +
    `things you can look up.`);
  if (planners.length) {
    const rules = R && A
      ? `${R.name} researches and posts a plan proposal to ${A.name} and "lead". ${A.name} studies the current architecture, ` +
        `reviews the proposal against it and posts the solution design. They settle disagreements on the board (at most two ` +
        `rounds, with mcp__team__read wait_seconds 120). Then ${A.name} posts the agreed plan to "lead", starting with "PLAN:": ` +
        `the approach, the files that change, interfaces and names, and how the work splits into independent parts.`
      : R ? `${R.name} researches and posts the plan to "lead", starting with "PLAN:": the approach, the steps, the files that ` +
        `change, the risks and the sources.`
      : `${A.name} studies the current architecture and posts the solution design to "lead", starting with "PLAN:": the ` +
        `approach, the files that change, interfaces and names, and how the work splits into independent parts.`;
    out.push(`${step++}. Plan. Start ${names(planners)}: ${starts(planners)}Then add the requirements and these rules, word for ` +
      `word: "${rules} Then call mcp__team__finish with the plan and end. Nobody changes files in this phase."`);
  }
  if (devs.length) {
    out.push(`${step++}. Your plan, the user's OK. ${planners.length ? `When the plan is in, check` : `Plan the work yourself from the code:`} ` +
      `the approach, the files that change, and the parts. Before anyone builds, show the plan to the user with ` +
      `AskUserQuestion: the question holds the plan in a few lines (what changes, which files, the approach, the risks, ` +
      `how many developers); options "Go ahead" (first), "Change the plan" and "Stop". Wait for the answer. If the user ` +
      `wants changes, adjust the plan${planners.length ? ` (ask the planners again if needed)` : ``} and ask again. If they ` +
      `stop, end with the plan.`);
    const devTeam = [...devs, ...(tester ? [tester] : [])];
    out.push(`${step++}. Build. Decide how many developers the work needs: 1 for a small or tightly connected change, 2 or 3 ` +
      `only when it splits into independent parts. Never two developers on the same file. Use the names in this order: ` +
      `${devs.map((m) => m.name).join(", ")}. Start the developers${tester ? ` and ${tester.name}` : ``} in ONE message, ` +
      `subagent_type "general-purpose". Start each developer with model "haiku": the plan is agreed and each part is ` +
      `well-defined, so Haiku builds it fast and saves the user's usage${tester ? ` (${tester.name} keeps your model)` : ``}; only ` +
      `a part that needs real design decisions gets your model. Begin each Task prompt with its brief, word for word (leave out the developers you ` +
      `don't start, also in the briefs' team lists):\n${devTeam.map((m) => `- ${m.name}: ${brief(m, devTeam)}`).join("\n")}\n` +
      `Then add the approved plan, that agent's part (files, goal, constraints), and these rules, word for word: ` +
      (tester
        ? `"Developers build only their part. When a part is ready, the developer tells ${tester.name} (by name) what ` +
          `changed and where. ${tester.name} waits for that with mcp__team__read (wait_seconds 120), reviews the real code ` +
          `and runs the tests, and sends concrete findings back. The developer fixes them (or explains why not) and tells ` +
          `${tester.name}. At most two review rounds; ${tester.name} replies "OK" when it's good. Nobody finishes before ` +
          `${tester.name}'s OK or two rounds. Each agent's final report: what it did, what was found, what's still open; ` +
          `just before ending, it calls mcp__team__finish with that report."`
        : `"Developers build only their part, agree on shared names and interfaces on the board, and run the tests if ` +
          `the project has any. Each one's final report: what it did and what's still open; just before ending, it calls ` +
          `mcp__team__finish with that report."`));
  } else {
    out.push(`${step++}. Result. The plan is the result: nobody changes files. Give it to the user.`);
  }
  out.push(`${step}. Report. When everyone has reported: ${devs.length ? `check the result yourself (read the diff, run the tests), ` +
    `fix small gaps, and ` : ``}give the user a short summary: the plan, what each agent did${tester ? `, what ${tester.name} found and ` +
    `how it was fixed` : ``}, and what's still open.`);
  out.push(`${BOARD} You can use the board too, as "lead". Refer to the agents by name. Don't do their work yourself. ` +
    `While they work, don't post progress updates.`);
  return out.join("\n");
}

function teamServer(names, file) {
  return { command: process.execPath, args: [path.join(__dirname, "team-mcp.js")],
    env: { ELECTRON_RUN_AS_NODE: "1", KURAL_TEAM: names.join(","), KURAL_TEAM_FILE: file || "" } };
}

module.exports = { FRIENDS, TEAM_TOOLS, ROLES, DEVELOPERS, TEAM_STYLES, teamMembers, teamPrompt, projectPrompt, teamServer };

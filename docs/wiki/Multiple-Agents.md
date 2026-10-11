# Multiple Agents

Turn on **Multiple agents** in the chat's model menu (Claude, ChatGPT or Google Gemini). Instead of one assistant, a team works on your
request. The lead is always the **Project Manager**; you pick the other roles:

| Role | Name | Does |
|---|---|---|
| **Project Manager** (the lead) | | Gets the requirements from you, asks when something is unclear, runs the team, reports back |
| **Researcher** | Rachel | Searches online and in the code, proposes a plan |
| **Architect** | Ross | Studies your project's architecture, picks the solution, splits the work into parts |
| **Developers** | Monica, Chandler, Joey | Build the approved plan, each their own part (the PM starts 1–3). With Claude they run on Haiku: the plan is agreed by then, so it's faster and saves usage |
| **Tester** | Phoebe | Checks every piece of code: quality, tests, edge cases |

Any combination works. Then pick how they work:

- **Split the work** (a project): the PM asks you what's unclear → the Researcher and Architect plan → **you OK the plan**
  (Go ahead / Change the plan / Stop) → the Developers build → the Tester reviews (up to two rounds) → the PM reports.
  With only a Researcher and/or an Architect, the plan is the result.
- **Discuss & decide**: each agent forms its own view first, then they argue it out and agree. The answer shows
  everyone's final position and any disagreement left.

With Claude, the Tester keeps your model. In a team without roles, the lead starts well-defined mechanical parts on
Haiku too.

**A big task in Auto.** In **Auto** mode with one agent, a big task shows "This looks like a big task. Use 3 agents?"
above the chat box, with **Use 3 agents**, **One agent** and a countdown. **Use 3 agents** turns the team on. **One
agent**, or no answer within 15 seconds, goes on with one agent, and Kural doesn't ask again in that chat. Stop while it
waits sends nothing.

You see reports in the answer as agents finish each phase, with an activity card for each agent. Claude agents can
also post to each other while they work. Codex and Gemini agents receive their teammates' reports between phases.

**Finish now** (next to "Waiting for …") stops the agents and the lead answers with what it has. An agent that shows
no sign of life for 6 minutes is stopped by itself.

For Codex and Gemini, Kural runs separate sessions with the same account and selected model. Developers build
concurrently only when the plan assigns separate files; an overlapping plan uses one developer. **Plan** and **Ask**
produce a plan or discussion without building. In **Agent** or **Auto**, building waits for your **Go ahead**.
The Tester can review and request one fix round, then reviews again. **Stop** cancels the whole team; queued messages
are answered after the current team finishes. Reports and conversation history survive a restart.

Gemini keeps its normal mode restrictions: in **Agent**, it edits files but runs no commands; **Auto** allows commands.
All sessions count toward the provider's usage. With [[Your Own Model]], the chat works with one assistant.

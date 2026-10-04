# Multiple Agents

Turn on **Multiple agents** in the chat's model menu (Claude models). Instead of one assistant, a team works on your
request. The lead is always the **Project Manager**; you pick the other roles:

| Role | Name | Does |
|---|---|---|
| **Project Manager** (the lead) | | Gets the requirements from you, asks when something is unclear, runs the team, reports back |
| **Researcher** | Rachel | Searches online and in the code, proposes a plan |
| **Architect** | Ross | Studies your project's architecture, picks the solution, splits the work into parts |
| **Developers** | Monica, Chandler, Joey | Build the approved plan, each their own part (the PM starts 1–3) |
| **Tester** | Phoebe | Checks every piece of code: quality, tests, edge cases |

Any combination works. Then pick how they work:

- **Split the work** (a project): the PM asks you what's unclear → the Researcher and Architect plan → **you OK the plan**
  (Go ahead / Change the plan / Stop) → the Developers build → the Tester reviews (up to two rounds) → the PM reports.
  With only a Researcher and/or an Architect, the plan is the result.
- **Discuss & decide**: each agent forms its own view first, then they argue it out and agree. The answer shows
  everyone's final position and any disagreement left.

You see the discussion live: the agents' messages to each other appear in the answer as they're sent. Each agent has a
card with what it's doing now, its thinking and its notes.

**Finish now** (next to "Waiting for …") stops the agents and the lead answers with what it has. An agent that shows
no sign of life for 6 minutes is stopped by itself.

Agent teams need Claude: they use Claude Code's background agents. With [[Your Own Model]], the chat works with one
assistant.

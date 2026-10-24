# Parallel Agents

Big requests go faster when several agents work on them at once, and cost less of your usage when those agents use a
lighter model. With **parallel agents** (like Cursor's), the model you picked plans the request and splits it, agents
build the parts at the same time, each in its own copy of the project, and Kural merges their work into yours.

## Turn it on

Open the chat's model menu and tick **Split big tasks** under **Parallel agents**. Below it, **Agents use** is the model
the agents get by default: one of the chat's AI's models (Opus, Sonnet or Haiku for Claude; ChatGPT's or Gemini's
models for those). Kural remembers it for each AI. The model button then says "· Parallel".

It works in **Agent** and **Auto** modes, in a project that is a **Git repository**, with Claude, ChatGPT (Codex) and
Google Gemini. Not with a model on this computer: every agent would share its one GPU, so it would be slower, not faster.

## What happens

1. **The plan.** The model you picked (the lead) reads the code, read only, and splits the request into up to four
   tasks that don't wait on each other, split by file or module where possible. A small request, a question, or work
   that can't be split stays one task: the lead simply does it, like an ordinary answer.
2. **Your OK.** A card shows the lead's approach and one row per agent: its task, the files it plans to change, and its
   model (your default picked). Change any agent's model, then press **Go ahead**. **Stop** ends it without changes. Or
   write what to change and press Enter: the lead plans again. In **Auto** mode there's no card: the agents start with
   your default model.
3. **The agents work at the same time.** Each gets its own git worktree: a copy of your files exactly as they are now,
   uncommitted changes and new files included. They change only their copy, never your files, so nothing collides
   while they work. Each shows as a card with what it's doing; commands they run ask you as usual in Agent mode.
4. **The merge.** Kural merges the agents' work one after another. When two changed the same lines, the lead resolves
   the conflict. If it can't, that agent's work is left out, and the answer says so.
5. **Into your project.** The merged files come in through the same checkpoint as any change the AI makes, so **Files
   changed**, **Review**, **Undo** and **Restore code** work as always. A file you edited while the agents worked is
   merged with your edit; a real clash gets git's conflict markers, and the lead fixes it.
6. **The check.** The lead runs the project's checks (tests, build, lint), fixes what doesn't fit together, and gives
   one answer: what each agent did and with which model, what it checked, and what's still open.

**Stop** at any point leaves your files as they were. **Finish now** (under the answer while agents work) stops the ones
still working and goes on with the finished ones.

## Good to know

- **Your repository stays as it is.** No branch is made, your index and your branch aren't touched, and the worktrees are
  removed when the answer ends. The agents' commits exist only in git's object store until git cleans it up.
- **Dependencies aren't copied.** Ignored folders such as `node_modules` aren't in the agents' copies, so they don't
  install packages or run the full test suite there; the lead does that after the merge, in your project.
- **When is it faster?** When the work splits into independent parts: several features, one module each, tests for
  separate files. Five features that all change the same central file split poorly: the merge and the lead's check
  take the time saved.
- **When is it cheaper?** Planning and the final check use the model you picked; the building uses the agents' model.
  Leading with Opus and building with Haiku or Sonnet saves most of your usage.
- **Each answer stands alone.** The lead gets the conversation so far from Kural each time. When you turn parallel agents
  off, the next answer starts a new session that's handed the conversation, so nothing is lost.
- Messages you send while it works are answered right after, as your next message.

See also [[Chat]] and [[Model Router]].

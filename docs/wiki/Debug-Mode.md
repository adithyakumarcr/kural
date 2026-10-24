# Debug Mode

Some bugs can't be found by reading code: they depend on what happens when the program runs. **Debug mode** (like
Cursor's) lets the AI watch the program run: it adds temporary logging, you reproduce the bug, and it reads what
happened before it changes anything.

## Turn it on

Open the chat's mode menu and choose **Debug**, beside Agent, Auto, Plan and Ask. Describe the bug: what you did, what
you expected, what happened.

## What happens

1. **Hypotheses.** The AI reads the code and lists the most likely causes, a few, most likely first.
2. **Logging.** It adds temporary logging to the code that sends to a **Kural log server** on your computer. The server
   listens only on `127.0.0.1`: nothing from it leaves your computer. Every added line is marked `kural-debug`.
3. **You reproduce it.** The AI tells you what to do (run the app, click, call the API) and waits.
4. **The logs.** It reads what came in and tells you which hypothesis was right and why.
5. **The fix.** It fixes the cause, not the symptom.
6. **The clean-up.** It removes every `kural-debug` line it added. You can check it under **Files changed** in the
   answer.

## What it may do

Debug mode behaves like **Agent**: it changes files and **asks before commands**, with the same cards ([[Chat]]
explains the modes).

> [!TIP]
> If the AI says it can't tell from the logs, reproduce the bug once more: a second run often shows what the first
> one hid.

## Good to know

- Search the project for `kural-debug` if a chat was stopped in the middle: it finds every line that is left.
- **Stop** ends the answer where it is: look for `kural-debug` lines in **Files changed** if it stopped before the clean-up.

See also [[Fix with Kural]] and [[Chat]].

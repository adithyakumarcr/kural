# ChatGPT and Gemini

Besides Claude, Kural can use **ChatGPT (Codex)** and **Gemini** with your own account. Like Claude, Kural runs the
official program in the background and uses its login: there's no key to paste into Kural.

| | ChatGPT (Codex) | Gemini |
|---|---|---|
| Program | [Codex CLI](https://developers.openai.com/codex/cli) (`codex`) | [Gemini CLI](https://github.com/google-gemini/gemini-cli) (`gemini`) |
| Account | ChatGPT Plus, Pro, Business or Enterprise (or an OpenAI API key) | a Google account (free tier) or a Gemini API key |
| Install (Mac) | `brew install codex` | `brew install gemini-cli` |
| Install (Ubuntu, Windows) | `npm install -g @openai/codex` | `npm install -g @google/gemini-cli` |

## Set it up

**Get started** → **ChatGPT (Codex)** or **Gemini**. Three steps, like Claude:

1. **Installed.** **Install for me** runs the official install in a terminal (npm needs [Node.js](https://nodejs.org)).
   Installed somewhere Kural can't find? **Choose the codex/gemini file…** (settings `kural.codexPath`,
   `kural.geminiPath`).
2. **Logged in.** **Log in** starts the program's own login in a terminal; it opens your browser.
3. **A test.** One tiny request. When it passes, its models appear in the chat's model menu.

## What works

- The chat in every mode: it reads and edits files, runs commands (asking first in Agent mode), and each change can be
  kept or undone. Thinking shows like Claude's.
- Ask, Ctrl+K, Apply, commit messages and plain words in the terminal use the chat's model, so these too.
- The usage meter: Codex shows its 5-hour and weekly limits like Claude; Gemini shows the tokens used today.
- The Account menu: who's logged in, the usage page, switch account, log out.

## What needs Claude

- [[Multiple Agents]]
- Claude Code's connectors, MCP servers, plugins and skills
- Linking Jira tickets

Switching a chat between Claude, Codex, Gemini and your own model works: the new model gets the conversation so far.

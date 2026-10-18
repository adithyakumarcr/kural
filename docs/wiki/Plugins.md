# Extensions & Plugins

The Extensions icon in the left side bar (Ctrl+Shift+X, Cmd+Shift+X on a Mac) has two tabs, like [[Search and Ask]]:

- **Extensions**: VS Code's own Extensions view, as it always was (extensions from Open VSX: search, install, update,
  turn off).
- **Plugins**: the **AI plugins** of the AI your chat uses: skills, slash commands, agents, hooks and MCP servers that
  the AI's own program loads (Claude Code, Codex or Antigravity). For example
  [Superpowers](https://github.com/obra/superpowers) (brainstorm, plan, test-first build).

"Kural: Show Plugins" opens the Plugins tab from the Command Palette.

## Whose plugins

The tab follows the chat's model. With a Claude model it shows Claude's plugins; switch the chat to a ChatGPT (Codex)
model and it shows Codex's; with Google Gemini, Antigravity's. A model on your computer doesn't use plugins. **Plugins
for** at the top shows another AI's plugins without changing the chat's model.

| AI | Where plugins come from | What you can do |
|---|---|---|
| Claude | **Anthropic's plugin directory** (built into Claude Code, a few thousand plugins) and the marketplaces you add | Install, Turn Off / On, Update, Remove |
| ChatGPT (Codex) | The marketplaces you add (none at first) | Install, Remove (Codex can't turn a plugin off) |
| Google Gemini (Antigravity) | No catalog: a folder, or a Git address (https) | Add, Turn Off / On, Remove |

## The list

- **Installed**: what this AI has. A plugin that's turned off says **Off**; one a project set up (its own
  `.claude/settings.json`) says **This project** and is left to that project.
- **Available** (Claude, Codex): what you can install. The search box filters everything (all your words must match;
  names that match come first).
- **Marketplaces** (Claude, Codex): where the plugins come from. **Add a Marketplace…** takes `owner/repo` (a GitHub
  repository, such as `obra/superpowers-marketplace`), an `https://` Git address, or a folder. Anthropic's directory is
  built in and can't be removed.
- **Add a plugin** (Gemini): **From a Folder…** or **From a Git Address…** (Kural downloads it, then Antigravity checks
  it before anything is added).
- **Refresh** is in the side bar's title bar.

Click a plugin for its page: where it comes from, its author and license, what it adds (skills, agents, hooks, MCP
servers), and for Claude how many tokens it adds to every chat before you ask anything (Claude Code's estimate).

## Installing is your decision

A plugin runs code on your computer as you: its hooks and MCP servers start with the AI, and Kural's approval cards
don't ask about them. So **Install** always asks first and says where the plugin comes from (its repository and
marketplace). A plugin whose marketplace installs it by running a command shows you that exact command first; only
**Run and Install** runs it. Install only plugins you trust.

## In your chats

- **Claude**: the chats reload with the change by themselves, in the same conversation. Claude's chats use plugins only
  with **Use my Claude Code setup (plugins, skills)** on (Kural Settings → Claude); the Plugins tab says so when it's off,
  with a button to turn it on.
- **ChatGPT (Codex)** and **Gemini**: the chats start again with the change at their next message, in the same
  conversation. In Plan and Ask, Kural turns plugins' connectors off for Codex, as it does for every connector.

Claude's and ChatGPT's plugins belong to the [[profile|Account and Updates]] you're in (each profile has its own Claude
and Codex folders); Gemini's are the same in every profile.

The same plugins can also be managed in a terminal: `claude plugin …`, `codex plugin …`, `agy plugin …`. The tab shows
what those commands say.

## When the tab isn't there

Kural adds the Plugins tab to VS Code's own Extensions side bar. If a newer VS Code changes that side bar so Kural can't
add it, the Extensions side bar stays as VS Code made it and Plugins gets a side bar of its own (the plug icon), with
everything above.

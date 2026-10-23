# Extensions & Plugins

The Extensions icon in the left side bar (Ctrl+Shift+X, Cmd+Shift+X on a Mac) has three tabs, like [[Search and Ask]]:

- **Extensions**: VS Code's own Extensions view, as it always was (extensions from Open VSX: search, install, update,
  turn off).
- **Plugins**: the **AI plugins** of the AI your chat uses: skills, slash commands, agents, hooks and MCP servers that
  the AI's own program loads (Claude Code, Codex or Antigravity). For example
  [Superpowers](https://github.com/obra/superpowers) (brainstorm, plan, test-first build).

- **Connectors**: the **connectors** (MCP servers) of the AI your chat uses, Claude's or ChatGPT's: add, sign in, turn
  off in Kural, remove (see [Connectors](#connectors) below).

"Kural: Show Plugins" opens the Plugins tab from the Command Palette, "Kural: Show Connectors" the Connectors tab.

## Connectors

They used to be on each AI's page in Kural Settings; now they're here, beside the extensions and plugins. The tab
follows the chat's model (Claude's connectors for a Claude model, ChatGPT's for Codex); **Connectors for** shows the
other one. Google Gemini and a model on this computer have none Kural can manage.

- Each connector shows its state (Connected, Needs sign-in, Failed, Off in Kural). **Sign in** opens a terminal (Claude:
  type `/mcp`, pick it, Authenticate; Codex: its own login). **On** turns it off or on everywhere in Kural (its tools
  are hidden from Kural's chats of that AI; `claude` or `codex` in a terminal still has it). The trash icon removes
  yours (it asks on the row first); claude.ai's are removed on claude.ai, a plugin's with its plugin.
- **Add connector**: Popular ones (Notion, Linear, Sentry, Atlassian, GitHub…) and the official MCP directory as you
  type. A directory result shows the exact command or address first (nobody checked it). Fill in a token or a folder
  only if it asks. **Add one by hand** takes a command or a web address.
- Claude: **Use my Claude Code setup (plugins, skills)** and **Reload** are at the bottom. See [[Chat]].
- Without Kural's Extensions side bar tab (another VSCodium's code), Connectors sit in the Plugins side bar of their own.

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

- **Installed**: what this AI has. A plugin that's turned off says **Off**. A Claude plugin installed only for the open
  project says **This project** or **This project, only me**; one your organisation set up for you says
  **Organisation** and is left alone. A plugin installed in two places (for all your projects and for this one) has a
  row for each: Turn Off and Remove act on that row's place.
- **Available** (Claude, Codex): what you can install. The search box filters everything (all your words must match;
  names that match come first).
- **Marketplaces** (Claude, Codex): where the plugins come from. **Add a Marketplace…** takes `owner/repo` (a GitHub
  repository, such as `obra/superpowers-marketplace`), an `https://` Git address, or a folder. Anthropic's directory is
  built in and can't be removed.
- **Add a plugin** (Gemini): **From a Folder…** or **From a Git Address…** (Kural downloads it, then Antigravity checks
  it before anything is added).
- **Refresh** is in the side bar's title bar.

Click a plugin for its page: where it comes from, its author and license, and what it adds: each skill, command and
agent with its own description, the hooks it runs by itself (and what they run) and its MCP servers (and the program or
address each one uses), then its README. For Claude, also how many tokens it adds to every chat before you ask anything
(Claude Code's estimate).

A plugin you haven't installed yet is read from its GitHub repository, at the version its marketplace offers, so you can
see what it would add before you install it. Kural asks GitHub without a login, which allows 60 plugin pages an hour;
past that the page says when to try again. A plugin that isn't on GitHub shows only what its marketplace says. The
README's pictures aren't loaded: each is a link you can open.

## Installing is your decision

A plugin runs code on your computer as you: its hooks and MCP servers start with the AI, and Kural's approval cards
don't ask about them. So **Install** always asks first and says where the plugin comes from (its repository and
marketplace). A plugin whose marketplace installs it by running a command shows you that exact command first; only
**Run and Install** runs it. Install only plugins you trust.

### Where a Claude plugin goes

With a project open (and trusted), Claude's **Install** asks where:

| Choice | Used by | Saved in |
|---|---|---|
| **All My Projects** | every Claude chat, in every folder | your Claude Code settings (`~/.claude/settings.json`) |
| **This Project (Shared)** | chats in this project, for everyone who works on it | the project's `.claude/settings.json`, which goes into Git with it |
| **This Project, Only Me** | chats in this project, only yours | the project's `.claude/settings.local.json` (yours, not meant for Git) |

With no project open, it goes to all your projects. ChatGPT (Codex) and Gemini have one place: all your projects.

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

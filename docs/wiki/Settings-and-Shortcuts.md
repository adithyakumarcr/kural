# Settings and Shortcuts

## Keyboard shortcuts

On a Mac, use **Cmd** where it says Ctrl, except where it says *(Ctrl on Mac too)*.

| Shortcut | What it does |
|---|---|
| **Ctrl+L** | open the chat; with code selected, adds it to the message |
| **Ctrl+Alt+N** | new chat tab |
| **Ctrl+PageDown / Ctrl+PageUp** | next / previous chat tab (Mac: Cmd+Alt+Right / Left) |
| **Ctrl+W** (in the chat) | close the chat tab |
| **Ctrl+K** | inline edit |
| **Ctrl+Enter** / **Ctrl+Shift+Backspace** | keep / reject an inline edit |
| **Ctrl+Alt+Space** | Tab Completion on/off *(Ctrl on Mac too)* |
| **Ctrl+Alt+A** | Ask |
| **Ctrl+Esc** | the full Claude Code terminal beside your file |
| In the chat: **Ctrl+M / H / O** | intensity Medium / High / Max *(Ctrl on Mac too)* |
| In the chat: **Ctrl+P** | Plan mode on/off *(Ctrl on Mac too)* |

## Settings

Open them with **File → Preferences → Settings** and search for "Kural".

| Setting | Default | What it does |
|---|---|---|
| `kural.chat.model` | sonnet | model for your very first chat (later chats use what you picked last) |
| `kural.chat.intensity` | medium | intensity for your very first chat |
| `kural.chat.mode` | agent | mode for your very first chat |
| `kural.chat.fullClaudeCodeSetup` | on | the chat uses your whole Claude Code setup (connectors, MCP servers, plugins, skills, hooks) |
| `kural.fontSize` | 0 | text size in the chat and Ask panels (0 = the editor's size) |
| `kural.tabCompletion.*` | | see [[Tab Completion]] |
| `kural.localModels.contextLength` | 32768 | how much a model on your computer can look at once |
| `kural.claudePath` | (empty) | where the `claude` program is, if Kural can't find it |
| `kural.codexPath`, `kural.geminiPath` | (empty) | where the `codex` / `gemini` programs are, if Kural can't find them |
| `kural.updates.autoCheck` | on | check for a new Kural version once a day |

## Themes

**Kural Dark** and **Kural Light**: Command Palette → *Preferences: Color Theme*. In Kural Light every text color has at
least 4.5:1 contrast with its background. With *Window › Auto Detect Color Scheme* on, Kural follows your computer's
light/dark mode.

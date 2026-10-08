# Settings and Shortcuts

## Keyboard shortcuts

On a Mac, use **Cmd** where it says Ctrl, except where it says *(Ctrl on Mac too)*.

| Shortcut | What it does |
|---|---|
| **Ctrl+L** | show or hide the chat; with code selected in the editor, adds it to the message |
| **Ctrl+Alt+N** | new chat tab |
| **Ctrl+PageDown / Ctrl+PageUp** | next / previous chat tab (Mac: Cmd+Alt+Right / Left) |
| **Ctrl+W** (in the chat) | close the chat tab |
| **Ctrl+K** | inline edit |
| **Ctrl+Enter** / **Ctrl+Shift+Backspace** | keep / reject an inline edit |
| **Ctrl+Alt+Space** | Tab Completion on/off *(Ctrl on Mac too)* |
| **Ctrl+Shift+F** / **Ctrl+Shift+H** | Search / Replace in files (Search & Ask side bar) |
| **F4** / **Shift+F4** | next / previous search result |
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
| `kural.notifications` | whenAway | a system notification when a chat's answer is done or needs you: `whenAway` (Kural's window isn't in front, or that chat isn't on screen), `always`, `off`. macOS asks once whether Kural may send notifications (if you chose Don't Allow: System Settings → Notifications → Kural) |
| `kural.chat.keepAwake` | on | while a chat is working, the Mac doesn't go to sleep by itself (the screen may still turn off; the lid still sleeps it). macOS only |
| `kural.welcomeWhenEmpty` | on | closing the last editor tab opens the Welcome page (not when that tab was Welcome itself) |
| `kural.chat.didYouKnow` | on | a short "Did you know?" tip under an answer while it's being worked on |
| `kural.chat.moods` | (none) | your own chat moods (name, hint, instructions); edit them in Kural Settings → Moods |
| `kural.chat.hiddenMoods` | (none) | built-in moods (Default, Explorer, Critic, Learn) removed from the chat's model menu; remove or restore them in Kural Settings → Moods |
| `kural.usageSwitch.enabled` | off | automatically move the same chat to another available AI when its reported usage reaches your threshold; edit in Kural Settings → AI Usage |
| `kural.usageSwitch.threshold` | 70 | percentage used that triggers switching (1–99); applies to Session and relevant Weekly limits |
| `kural.fontSize` | 0 | text size in the chat and Ask panels (0 = the editor's size) |
| `kural.tabCompletion.*` | | see [[Tab Completion]] |
| `kural.localModels.contextLength` | 32768 | how much a model on your computer can look at once |
| `kural.claudePath` | (empty) | where the `claude` program is, if Kural can't find it |
| `kural.agyPath`, `kural.codexPath` | (empty) | where the `agy` (Google Gemini) / `codex` programs are, if Kural can't find them |
| `kural.updates.autoCheck` | on | check for a new Kural version once a day |
| `kural.showDebugViews` | off | show VS Code's Run and Debug side bar and the Debug Console and Ports panels (hidden to keep Kural simple; while you debug with F5, the debug views show anyway) |

## Themes

**Kural Dark** and **Kural Light**: Command Palette → *Preferences: Color Theme*. They look like VS Code's own (Dark
Modern / Light Modern): code in many colors (keywords, strings, functions, types, comments each their own, as in
VS Code's Dark+ / Light+), and purple, Kural's color, only for buttons, the active tab, focus and links. Code in chat
answers is colored the same way. Every text color has at least 4.5:1 contrast with its background. With *Window › Auto Detect Color Scheme* on, Kural follows your computer's
light/dark mode.

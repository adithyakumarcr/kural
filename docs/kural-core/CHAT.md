# Kural Core: the chat

The chat is most of Kural (legacy: `extension/lib/chat/index.js` `ChatView`, ~3,150 lines, plus `lib/chat/*.js`; the page
`extension/media/chat*.js`, `markdown.js`, `timeline.js`, `choices.js`, `side.js`, `split.js`, `voice.js`, `listen.js`, `mermaid-view.js`).
This is how it moves (PLAN M4). Read `ARCHITECTURE.md` first.

## What the legacy split already gives us
The legacy chat is two halves that only talk by messages: the page posts ~110 kinds to the backend (`send`, `stop`,
`permission`, `answer`, `setModel`, `setMode`, `newTab`, `switchTab`, `fork`, `restore`, `sideAsk`, `voiceChunk`, …) and the
backend posts ~50 kinds back (`tabs`, `full`, `block`, `delta`, `thinkDelta`, `patch`, `permState`, `questionState`,
`queued`, `unqueue`, `splitState`, `sideDelta`, `listenAudio`, `voiceState`, `history`, `slash`, …). The backend uses few
VS Code APIs, almost all for UI (warnings, quick picks, opening files, commands, the active editor's selection).

So the move keeps that split and puts each half where it belongs:

```
 workbench (one per project view)                          Kural host (one for the app)
 ┌──────────────────────────────────────┐   ChatCommand    ┌─────────────────────────────────────────┐
 │ KuralChatView (native ViewPane):      │ ───────────────▶ │ ChatEngine                              │
 │  columns, tabs, the transcript DOM,   │                  │  chats (tabs), turns, queue, sessions   │
 │  timeline, markdown, questions, side  │ ◀─────────────── │  (IAgent via the providers), permissions│
 │  chat, voice capture, Listen player   │   ChatEvent      │  policy, checkpoints, History, handoff, │
 │ KuralChatEditor (a chat beside code)  │                  │  Model Router, parallel agents, side    │
 │ KuralChatWorkbenchBridge: what only   │ ◀── calls ────── │  chat, Enhance, Listen/Whisper workers   │
 │  the window can do (dialogs, open a   │                  │                                         │
 │  file, the editor's selection, …)     │ ── context ────▶ │  (per window: folders, trust, settings, │
 └──────────────────────────────────────┘                  │   focus, which chats are on screen)     │
                                                           └─────────────────────────────────────────┘
```

- **`ChatEngine`** (`src/vs/platform/kural/node/chat/`): the legacy `ChatView` without its panes and without vscode. It owns
  every chat of every open project (a chat belongs to a workspace key), so a chat keeps running whatever the window does.
  Its inputs are `ChatCommand`s; its outputs `ChatEvent`s addressed to a window and, where it matters, a pane.
- **The contract** (`src/vs/platform/kural/common/chat/protocol.ts`): `ChatCommand` and `ChatEvent` as discriminated unions
  of the legacy message shapes (same `type` names, same fields), so the port is checkable message by message against the
  legacy code. Settings, Search and other pages' messages are not part of it: they belong to their own features.
- **The workbench side** (`src/vs/workbench/contrib/kural/browser/chat/`): the legacy page's DOM code as native TypeScript
  (it is plain DOM already: no framework, no innerHTML from the AI), in a `ViewPane` in the secondary side bar (columns and
  the tab drag as today) and in an `EditorPane` for a chat beside the code (no webview, no cross-frame drag problem: a tab
  dragged out is an ordinary editor drag). Codicons and themes are native; the CSP work, `fileSrc()`, the microphone
  patches and `kural.chatFocused` reporting go away.
- **`KuralChatWorkbenchBridge`**: the engine asks the window for what only it can do: a modal question
  (`showWarningMessage` with buttons), a quick pick, opening a file at a line, an image, a link in Kural's browser, the active
  editor's selection, saving a dirty editor before a change is applied, a terminal, the clipboard, running a command. The
  window pushes its context: workspace folders and trust, the `kural.*` settings, whether the window is focused, which
  chats are on screen in which panes.

## Data
Same places as the legacy chat (ARCHITECTURE §2 "Data compatibility"): History in `globalStorage/kural.kural/chats/`,
checkpoints, handoffs, images, local-chats, lessons; the open tabs per window (`kural.chat.v4` in the window's
workspace storage under the extension's key) are read by the window and handed to the engine when it connects; chat
defaults (`kural.chat.last`) and the other globalState keys from the application storage.

## Order of work (after T4 and T5)
1. The contract from the legacy code (every message the page posts and the backend posts, with its fields).
2. The engine, module by module, with the legacy tests that cover the chat's logic ported (`test/queue.test.js`,
   `chat-*.test.js`, `permissions.test.js`, `private-folders.test.js`, `side-chat.test.js`, `router-chat.test.js`,
   `split-chat.test.js`, `shortcuts.test.js`, `slash.test.js`, …), driving it with the fake programs.
3. The view, from the page code, with the legacy page tests ported to the workbench's browser tests.
4. Switch-over: `kural.chat.*` commands, the views and settings registered by core; the legacy chat deleted.

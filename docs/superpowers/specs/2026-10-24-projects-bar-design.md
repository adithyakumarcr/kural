# Projects bar: design

Date: 24 Oct 2026. Agreed with Adithya in chat, from the clickable mockup (`/tmp/kural-projects-mockup/projects-bar.html`,
throwaway).

## Goal

Switching between projects is easier when every project, and every chat in it, is in one list. Today each project is
its own window and you find them through the Dock or File → Open Recent, and a chat that finishes in another project's
window only says so with a system notification while you're away.

Done when: from any Kural window you see what every open project's chats are doing, and you reach a finished one in one
click.

## What was decided (and what wasn't)

| Decision | Choice |
|---|---|
| Window model | One window per project (VS Code's). The bar brings a project's window to the front, or opens one. Switching in place was rejected: opening another folder restarts the window and stops its chats |
| Where | A **Projects** tab in the left bar, first, Kural's default on every window start. It can't be hidden or moved |
| Project rail (a strip of squares beside the left bar) | Not wanted |
| Chats | Every open chat of an open project is listed under it, no "N more" |
| Explorer with no folder | VS Code's "You have not yet opened a folder" page is gone: the Explorer is empty |
| Pop-up for a chat finished in another window | Kural's own card (colored square, bold title, grey line, a button), VS Code's notification as the fallback |
| Close a project | A red × on its row, then a confirmation; working chats are named there |
| New empty project | Makes the folder, runs `git init`, opens it |
| Status bar | "N projects need a look" while true |

## What you see

The **Projects** view, title "PROJECTS", with + (Open folder…, Clone Git repository…, New empty project (with Git)…) and
Collapse all; a search box "Find a project or chat"; three sections:

- **Pinned**: your pins, open or not.
- **Open**: projects with a Kural window right now, not pinned.
- **Recent**: VS Code's own recent list (File → Open Recent), without the open and pinned ones. Folders and
  `.code-workspace` files on this computer only (remote ones are left out).

A project row: arrow (fold), a square in its Workspace Color with its first letter, name, "this window" on the one you're
in, a second line `branch · ~/path` (Recent: `~/path · yesterday`), and on the right a purple number (finished answers you
haven't seen), the pin, and when you point at it a red × (open projects: Close project) or a red bin (Recent: Remove from
Recent). A folded project shows a spinner / orange dot on its own row when a chat inside is working / waiting.

Under an open project, each open chat tab: an icon (spinner = working, orange dot = waiting for you, purple dot +
bold name = finished, not seen yet, speech bubble = nothing new), the chat's title, and on the right "Working", the
question ("Allow npm run build?"), "Done · 5 min ago", or "on screen" for the one showing in this window. Order: waiting,
finished, working, then the rest in tab order. A closed project keeps only its unseen finished chats (shown under it in
Pinned/Recent) until you open it.

The left bar's Projects icon carries a number: other projects' unseen finished chats plus chats waiting for you. The
status bar shows "$(folder-library) 2 projects need a look" while that number isn't 0; clicking it opens Projects.

## Clicks

| Click | What happens |
|---|---|
| A project (open in another window) | `vscode.openFolder(uri, {forceNewWindow: true})`: VS Code finds the window that has it and brings it forward (`windowsMainService.open` checks existing windows first; read in 1.140's mainImpl.js, to confirm live) |
| A project (not open) | Opens it in THIS window (`forceReuseWindow`, like Open Recent; changed 24 Oct 2026). A chat working or waiting here → a modal: Open Here (stops it) / Open in New Window |
| A chat | The same, plus an "open chat" request to that window, which shows that chat (and so marks it seen) |
| Pin | Pins / unpins (kept in the shared folder, so every window sees it at once) |
| × on an open project | Modal confirmation (VS Code's `showWarningMessage({modal: true})`: on a Mac the system's own dialog): "Close weld-sim?", the working/waiting chats by name ("Closing stops them"), "Your chats stay in History…", buttons Close project / Cancel. This window → `workbench.action.closeWindow`. Another window → it's brought forward first (so VS Code's own "unsaved files" question is seen there), then gets a "close" request and closes itself |
| Bin on Recent | `vscode.removeFromRecentlyOpened` |
| + → Open folder… | Folder picker → open (rules above) |
| + → Clone Git repository… | The git extension's `git.clone` |
| + → New empty project… | Name (checked: not empty, no `/ \ :`, folder doesn't exist), then a folder picker for where (default: the last place used, else home; never a protected folder by default), `mkdir`, `git init` (`lib/git.js` `findGit`; no Git → the folder only, and a message), open in a new window |
| The card's "Go to weld-sim" | Same as clicking that chat |

## How it works

### Units

| File | No vscode? | Job |
|---|---|---|
| `extension/lib/projects/status.js` | yes | This window's status file and inbox: write (atomic, 0600), read all, which windows are alive, requests in and out |
| `extension/lib/projects/model.js` | yes | Turns the status files + pins + VS Code's recent list into the view's sections, rows, chat order, numbers |
| `extension/lib/projects/index.js` | no | `registerProjects(context, {chat, log})`: the WebviewView `kural.projects`, its badge, the status bar item, the commands, publishing this window's state, acting on requests, the card |
| `extension/media/projects.js`, `projects.css` | page | Draws the model (Codicons, theme colors, `el()` only, no innerHTML), search, fold, hover buttons; posts clicks |
| `extension/lib/chat/index.js` | no | `tab.unseen` (finished while not on screen), a snapshot of the open chats and a change event, `showChat(id)` |
| `extension/lib/chat/notify.js` | yes | A new route: the card in the Kural window you're in |
| `scripts/rebrand.py` | | Four workbench patches (below) |

### The shared folder

`scope.dir("projects", "data")` (so profiles that don't share data don't see each other's projects):

- `windows/<windowId>.json`, one per window, `windowId` = `<extension host pid>-<random>`:
  `{v: 1, pid, seen, focused, closed, key, name, folders: [path], workspaceFile, color, branch,
  chats: [{id, title, state: "run" | "ask" | "done" | "idle", ask, doneAt, onScreen}]}`.
  Written when something changes (chats, focus, branch, color: debounced 300 ms) and every 60 s (`seen`). On a normal
  close (deactivate): `closed: true` and only the `done` chats kept. Alive = `!closed`, `seen` < 3 min ago and the pid
  exists (`process.kill(pid, 0)`); a window that crashed reads as closed. When a project opens again, its new window
  deletes the old files with the same `key`. Closed files older than 30 days are deleted.
- `inbox/<windowId>/<time>-<random>.json`: `{type: "showChat", chatId}` | `{type: "close"}` | `{type: "card", …}`.
  The owner watches its inbox, acts, deletes; requests older than 30 s are dropped.
- `pins.json`: `[{path, workspaceFile}]`.

Every window watches `windows/` and `pins.json` (`fs.watch` plus a 5 s poll as a fallback) and redraws.

Nothing here reads another project's files: color and branch come from that project's own window (a project never
opened since this feature keeps the default color). Opening a project folder in `~/Documents` is the user's own click,
so it can ask macOS's permission; drawing the list never does.

### Chat states

From the chat backend, per open tab: `run` while an answer runs; `ask` while a permission card, a question or a plan
waits (with its short text); `done` when `tab.unseen`; else `idle`. `tab.unseen` is set in `finishReply` when
`!this.shown(tab.id)`, cleared when the tab is shown (activate, a pane becoming visible, `showChat`), saved with the tab.
Stop sets nothing (no "done" for a stopped answer, as with notifications).

### Notifications

When a chat finishes (or needs you) and its window isn't in front: if another Kural window is (a live status file with
`focused: true`), the finishing window sends that window a `card` request instead of a system notification; the
`kural.notifications` setting decides as today whether anything is sent. Otherwise nothing changes (system
notification while you're away from Kural).

The card: `_kural.card` (rebrand.py) draws it in the workbench, bottom right above the status bar: the project's square,
"weld-sim: \"Tune the arc model\" is done", a grey line, the button "Go to weld-sim", ×; it stays 12 s (paused while the
mouse is on it); answers `{clicked}`. Without the patch: `showInformationMessage(text, "Go to weld-sim")`.

### Workbench patches (`scripts/rebrand.py`)

All found by shape, applied once (running twice changes nothing), and a miss gives a `::warning::` and VS Code's normal
behaviour; each has a test on a stand-in and on the real workbench file when one is around (`test/workbench.js`). They
need a full `./install.sh`.

1. `drop_explorer_empty_view`: the Explorer's welcome content shown with no folder ("You have not yet opened a folder"
   with Open Folder / Clone Repository) is not registered. The Explorer shows its empty "No folder opened" header only.
2. `projects_default_view`: the side bar opens `workbench.view.extension.kural-projects` at every window start instead
   of the one remembered (`workbench.sidebar.activeviewletid`), and that container is first in the left bar. Fallback
   without the patch: Kural opens Projects when it starts (the remembered one may show for a moment).
3. `projects_always_shown`: the Projects container has no "Hide" in the left bar's right-click menu, can't be dragged
   to another place, and its view can't be hidden (`canToggleVisibility: false`, `canMoveView: false`).
4. `add_in_window_card`: the `_kural.card` / `_kural.cardClear` commands, inserted like `_kural.osToast`.

### package.json

View container `kural-projects` (activitybar, icon `media/projects-icon.svg`), webview view `kural.projects`; commands
`kural.projects.show`, `.open`, `.newProject`, `.clone`, `.collapseAll` (internal ones hidden from the palette); no new
settings.

## Not doing

Switching in place, the project rail, remote folders (SSH, WSL, containers) in Recent, macOS native tabs
(`window.nativeTabs` stays VS Code's setting), a "don't ask again" on the close confirmation.

## Testing

- `test/projects-status.test.js`: write/read, atomic files, alive vs crashed vs closed, adopting a reopened project,
  old files removed, inbox requests in order, old requests dropped (temp folder; fake pids).
- `test/projects-model.test.js`: sections, pins open and closed, Recent filtering, chat order, the numbers, a closed
  project keeping only unseen chats.
- `test/projects-chat.test.js`: `tab.unseen` set off screen, not on screen, cleared when shown, not after Stop; the
  snapshot and its change event; `showChat`.
- `test/projects-page.test.js`: the page on the tiny DOM used by the other page tests: rows, fold, search, hover
  buttons, red ×, posts.
- `test/projects-notify.test.js`: card route chosen when another window is focused, OS route otherwise, setting off.
- `test/rebrand-projects.test.js`: the four patches (stand-in + real workbench).
- By hand in the built app: two projects open, a chat finishing in the other one (card, badge, status bar), Go to,
  close with a working chat, New empty project, start with no folder (Projects shown, Explorer empty), right-click on
  the Projects icon (no Hide).

## Docs

`lib/chat/guide.js` (a Projects entry), `docs/wiki/Projects.md` (+ the sidebar), README's feature list, CLAUDE.md
(how it works), RELEASE_NOTES.md under "Not released yet".

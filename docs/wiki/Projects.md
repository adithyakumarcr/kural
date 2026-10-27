# Projects

Kural opens each project in its own window (VS Code's way), so its chats keep running. The **Projects** tab, first in the left bar, puts every
project and every chat in them in one list, so you see what each chat is doing and reach a finished one in one click.

## The list

One list, like ChatGPT's project list: each project is a folder with its chats under it, in three sections, each with
its heading:

| Section | What's in it |
|---|---|
| **Pinned** | Your pins, open or not (a faint pin at the end of the row). Pins are kept for every window at once. |
| **Open** | Projects with a Kural window right now that aren't pinned, by name. The one in this window is bold and keeps its place. |
| **Recent** | VS Code's own Open Recent list, without the open and pinned ones, in grey with a closed folder. Folders and `.code-workspace` files on this computer only. |

The search button in the title bar opens a box (**Find a project or chat**) that finds projects and chats and marks what matched; Esc or its **×** clears and closes it.

A project shows its first five chats, then **Show N more** (a chat you're looking at stays in view). The folder is in
the tooltip. When you point at a row: the pin, and a red **×** (open projects: close) or a red bin (Recent: remove from
Recent). Click the folder icon (an arrow under the pointer) to fold a project's chats; a folded project shows its chats'
marks on its own row. **Collapse all** is in the title bar.

At the end of each chat:

| Mark | Meaning |
|---|---|
| Spinner | An answer is running |
| Orange dot, bold title | The chat waits for you (a permission, a question, a plan); the question is in the tooltip |
| Blue dot, bold title | It finished and you haven't seen it yet |
| Nothing | Nothing new (the one showing in this window is highlighted) |

A chat with nothing sent yet ("New chat") isn't listed.

Waiting chats come first, then finished, then working, then the rest in tab order. A closed project keeps only its
finished chats you haven't seen.

## Clicks

| You click | What happens |
|---|---|
| A project | Its window comes to the front. Not open (Recent, or a pin): in a Kural built from source (see below) it opens in the same frame without a question; otherwise it opens in this window, like File > Open Recent, and if a chat here is still working or waiting for you, Kural asks first: **Open Here** stops it (it stays in History), **Open in New Window** keeps it. |
| A chat | The same, and that window shows the chat (which counts as seen). |
| The pin | Pins or unpins the project. |
| The red × | Asks "Close weld-sim?" and names the chats that are working or waiting ("Closing stops them"); your chats stay in History. **Close project** closes the window (VS Code asks about unsaved files first). |
| The red bin | Removes the project from Recent. |

## Rename, delete and move a chat

Right-click a chat (in a project with a window) for **Rename**, **Move to...** and **Delete** (Kural's own menu, not Cut,
Copy and Paste); right-click a project for **Pin** / **Unpin** and **Close Project** or **Remove from Recent**.

- **Rename** (or F2 on a chat) turns its title into a box: Enter or clicking away saves, Esc cancels.
- **Delete** asks first, then removes the chat from its project and from History (a working chat stops).
- **Move**: drag a chat onto another project that has a window (the row lights up), or use **Move to...** for a list of
  them. The chat keeps its title, messages and place in History and shows up in that project's window. Claude keeps a
  conversation per folder, so its next message there starts a new conversation that's given the whole chat so far, like
  **Continue here** in History. A chat that's working or waiting for you can't be moved (its tooltip says so), and a
  project without a window doesn't take one. "Files changed" in a moved chat still means the old project's files.

A chat in another project's window is renamed, deleted or moved by that window: the bar sends it the request.

## The + menu

- **Open folder...** picks a folder or a `.code-workspace` file.
- **Clone Git repository...** is the Git extension's clone.
- **New empty project (with Git)...** asks for a name (not empty, no `/ \ :`, the folder must not exist yet) and a place
  (it starts where you made the last one, else your home folder, never a protected folder like Documents), makes the
  folder, runs `git init` and opens it in a new window. Without Git on the computer you get the folder only, and a
  message says so.

## Something needs a look

The Projects icon in the left bar shows a number: finished-and-unseen chats plus chats waiting for you, in your *other*
projects. The status bar says **N projects need a look** while that number isn't 0; click it to open Projects.

When a chat finishes (or needs you) in a window that isn't in front, and another Kural window is, that window shows a
small card in the bottom right ("weld-sim: ... is done", a button **Go to weld-sim**) instead of a system notification.
The card stays 12 seconds. Without it, or when you've left Kural, you get the usual notification ([[Settings and
Shortcuts]] has the setting `kural.notifications`).

## Same frame, no reload

In a Kural built from VS Code's source ([[Building from Source]]) every project still has its own window, but only one is
visible. Opening or switching to a project puts its window exactly over the one you're in (same place, size and
full-screen), shows it once it has painted, and hides the old one. Nothing reloads, nothing flashes, and the chats in the
window you left keep running. Closing the visible window shows the last hidden one; the Dock icon shows the last one;
**Show Next Window** and **Show Previous Window** switch (Mac: Cmd+` and Shift+Cmd+`; Windows and Linux: Ctrl+Alt+. and
Ctrl+Alt+, or "Show Next/Previous Window in Frame" in the Command Palette). Recent, pinned and new projects open this way too, without the "Open Here?" question. Cloning a
repository and choosing **Open** (also after `git init`) opens it in a new window the same way, so the chats in the window
you cloned from keep running. If a window you can't see needs to ask something (for example "Save changes?" when you quit),
it comes to the front first. The setting `kural.window.oneFrame` (on by default) turns it off. On Linux with Wayland a
window's place can't be set, so the new window keeps the old one's size and state (full screen, maximized) and the desktop
places it.

In a Kural built from the VSCodium download (the releases so far) none of this exists: windows come forward, and a project
that isn't open opens in this window as described above. Switching and closing were checked in a Mac build from source
(and Linux in a container, see [[Building from Source]]); the dialogs and Git's Open weren't tried in a running app yet.

## On Windows, Linux and the Mac

The Projects bar and the source build are meant for all three systems. A project is the same project however its path
is written: on Windows paths compare without regard to capitals (`C:\Work\App` and `c:\work\app` are one project), on
the Mac and Linux they are different. Windows builds from source on a Windows CI runner; Linux can be tried from a Mac in
a Docker container (`scripts/linux-container/run.sh`, [[Building from Source]]). Not tried yet on a real Windows computer.

## Good to know

- Switching a window to another folder in place would restart it and stop its chats, so Kural brings windows forward
  instead (or, from source, shows another window in the same frame).
- The Explorer with no folder open is just empty; the Projects list is where you pick one.
- The list reads only what each Kural window writes about itself (its color, branch and chat states) in Kural's own
  storage. It never looks into another project's files, so drawing it asks for no folder permission.
- Remote folders (SSH, WSL, containers) aren't in Recent.

## History and the Explorer

Each project has a folded **History** of its chats: click one to open it, drag it to another project, or right-click for Move to... and Fork to... (open chats get Fork to... too). The Projects view and the Explorer's views share one container, so projects can be collapsed and reordered.

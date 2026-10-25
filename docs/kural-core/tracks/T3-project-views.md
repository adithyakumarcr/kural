# T3: One window, many projects (project views)

PRD R3. Adithya: "if I switch between projects, I am still seeing a switch that's happening by tricking VS Code. That's
something I want to avoid." Today `patches/kural/0100-one-frame-windows.patch` keeps VS Code's rule (one OS window per
workbench) and fakes one window: a new project's window is placed exactly over the current one, shown when painted, and
the old one is hidden. The OS still has several windows: macOS full screen switches Spaces, Mission Control and the Dock see
several windows, dialogs of hidden windows needed special code, a flash can show.

## The feeling (Adithya, 25 Oct 2026, "very important")
Switching between open projects must feel like switching tabs in a browser or chats in Teams: no window closes or
opens, nothing reloads, nothing flickers, the other project is just there, instantly, where the window is. This is the
acceptance test of this track; the live test below measures it, it isn't judged by eye.

## The design to build (decided)
- A **frame** is a real OS window: an Electron `BaseWindow` that owns the title bar / traffic lights, size and position,
  full screen, minimize, the menu, and what the OS sees.
- Every open project is a **workbench view**: an Electron `WebContentsView` (a full workbench: its own renderer and its own
  extension host, exactly like today's window) inside a frame, sized to the frame's content area.
- Switching projects swaps the frame's visible view (and moves focus to it). Nothing reloads, nothing is hidden behind
  another window, background projects keep running (their chats too). Target: under 100 ms, no blank frame.
- One frame by default. A project can be moved into a frame of its own (a second monitor: "Move Project to New Window").
- Every system: macOS, Linux (X11 and Wayland) and Windows; `BaseWindow`/`WebContentsView` exist on all three (Electron 43).
- The setting `kural.window.oneFrame` (default true) keeps its name and meaning ("projects open in the same window");
  false = VS Code's behaviour, one OS window per project.

## You own
`patches/kural/01*.patch` (0100 is replaced by your patches; 0101 git-open-after-clone stays or changes as needed),
`src/vs/platform/kural/electron-main/frames/**`, `src/vs/platform/kural/common/frames/**`,
`src/vs/workbench/contrib/kural/*/frames/**`, their tests (`src/vs/*/kural/test/**/frames/**`),
`test/patch-one-frame.test.js` (replace it), `test/one-frame.live.js` (replace it), new `test/project-views*.js`,
`extension/lib/projects/**` and `test/projects-*.test.js` (only what the Projects bar needs to switch projects in a frame;
the native Projects bar comes later), `scripts/linux-container/inside.sh` only for running your live test.
You may add ONE import line to `src/vs/workbench/contrib/kural/electron-browser/kural.contribution.ts`.

## How to approach it
1. **Design first.** Read VS Code's window code at the pinned commit (`build/vscode-pristine` or a fresh
   `scripts/vscode/fetch.sh --pristine`): `src/vs/platform/windows/electron-main/{windowImpl,windowsMainService,windows,windowsStateHandler}.ts`,
   `src/vs/platform/window/electron-main/window.ts`, `src/vs/platform/native/electron-main/nativeHostMainService.ts`,
   `src/vs/code/electron-main/app.ts`, `src/vs/platform/menubar/electron-main/menubar.ts`,
   `src/vs/platform/dialogs/electron-main/dialogMainService.ts`, `src/vs/platform/auxiliaryWindow/electron-main/*`,
   `src/vs/platform/browserView/electron-main/*` (the Integrated Browser places its own WebContentsView in the window),
   `src/vs/platform/lifecycle/electron-main/lifecycleMainService.ts`. Also today's 0100 patch (its lessons: dialogs,
   Show Next/Previous Window, Windows/Linux maximize quirks, Wayland can't place windows). Write
   `docs/kural-core/reports/T3-design.md`: how `CodeWindow` gets a view instead of its own `BrowserWindow` while keeping
   its interface (`ICodeWindow`), what moves to the frame (bounds, full screen, title, represented file, document edited,
   minimize/maximize, focus, traffic lights / title bar overlay, the menu), how each of the 17
   `BrowserWindow.fromWebContents/fromId/getFocusedWindow/getAllWindows` uses in 9 files is replaced, how the Integrated
   Browser's views and the auxiliary windows behave, closing a project vs closing the frame, quitting with unsaved files in
   a background project, window state saved and restored (which projects in which frame, the visible one), the Dock and
   taskbar, keyboard focus, accessibility. Commit the design before you write code.
2. **Kural code over patches.** Put the frame logic in Kural's own classes (`src/vs/platform/kural/electron-main/frames/`)
   and keep the patches to the hooks VS Code's files need. Small, readable patches survive VS Code updates.
3. **Keep every window feature working:** the custom title bar on all systems, full screen (native on macOS: one window,
   so no Space jump), zoom, devtools per project, `Developer: Reload Window` (reloads only that project's view),
   restoring all open projects at start, "Open Recent", drag and drop of files onto the window, the Integrated Browser,
   auxiliary windows (editors popped out), the extension host and extension development host (dev hosts keep a normal
   window), the agents window (`vs/sessions`, leave it as VS Code has it), `--new-window`, opening a folder from the CLI
   or the Dock, the "Kural not responding" dialog, crash recovery of one view.
4. **Projects bar.** Make the legacy Projects bar (`extension/lib/projects/index.js`) switch projects through your frames
   (today it uses `_kural.oneFrame` and `vscode.openFolder` with `forceNewWindow`): a command Kural registers in the
   workbench (`_kural.showProject`, or keep `_kural.oneFrame` returning `{ enabled }` and make `openFolder` reuse the frame);
   chats keep running when you switch.
5. Show Next/Previous Window switches projects in the frame (Cmd+` / Shift+Cmd+`, Ctrl+Alt+. / Ctrl+Alt+, elsewhere).

## Check
- Type check, lint, unit tests for the frame logic you can test without Electron.
- A full Mac build through the lock; a live test (`test/project-views.live.js`, replacing `one-frame.live.js`): a throwaway
  copy with two or three projects, switched back and forth many times (through the Projects bar's command, Show Next
  Window, and opening a Recent project), driven over CDP and the main process's `--inspect`. It must show, measured:
  no OS window is created, shown, hidden or closed by a switch (count Electron's `browser-window-created`, BaseWindow
  `show`/`hide`/`closed` events and the app's windows in macOS's CGWindowList / X11's window list before and after);
  no workbench reloads (each view's `webContents` id and its page's `performance.timeOrigin` stay the same); the frame
  never shows an empty or half-painted view (capture the frame's content every ~16 ms during switches, e.g. with
  `webContents.capturePage` on the view that's shown or a screen capture of the window, and check each picture is fully
  one project's workbench); the switch is done in under 100 ms. Also: always exactly one OS window
  (`BaseWindow.getAllWindows()`, and macOS's CGWindowList for the app), a switch under 100 ms with no frame where nothing is
  painted, background project's extension host still alive, full screen stays in one Space (one window), closing a project,
  quitting with an unsaved file in a background project shows its question, restoring after restart.
- Linux: `scripts/linux-container/run.sh --platform linux/amd64 build` and `live` through the lock (X11 under Xvfb).
- Say clearly what is NOT checked (Windows, Wayland, real multi-monitor).

# Troubleshooting

- **See what Kural does:** **Kural: Show Log** (Command Palette, or Kural Settings → Show log) lists every request, with timings.
- **"Kural: finish setup" in the status bar:** click it. [[Getting Started|Getting Started]] shows which step is missing
  and how to fix it.
- **Claude says I'm not logged in:** click the person icon (Account) → **Log in**.
- **No Tab suggestions:** click the sparkle icon (Tab Completion) in the status bar. Crossed out = off. Which engine? "Last suggestion" shows
  whether suggestions arrive and how long they take. With **Local model**, the panel says whether Ollama and the model
  are ready.
- **Terminal suggestions don't show:** they need Kural's terminal with shell integration (bash, zsh, fish, PowerShell)
  and the setting `kural.tabCompletion.terminal` on.
- **A model on my computer is slow:** pick a smaller one, or lower `kural.localModels.contextLength`.
- **Where are Run and Debug, the Debug Console and Ports?** Hidden to keep Kural simple. Turn on the setting
  `kural.showDebugViews` (Settings, search "debug views") and they're back at once. While you debug (F5), Run and Debug
  and the Debug Console show anyway.
- **Mac says Kural is damaged:** run `xattr -dr com.apple.quarantine /Applications/Kural.app` in Terminal.
- **Windows says "Windows protected your PC" and only offers Don't run:** that's Microsoft Defender SmartScreen; it warns
  about every program that isn't code-signed and that it doesn't know yet, and Kural's installer isn't signed yet. Click
  the small underlined **More info** link: the window then shows the file's name, "Publisher: Unknown publisher" and a
  **Run anyway** button. Updates from inside Kural (Help → Check for Updates) don't show this again. With the portable
  `.zip` it would ask on every start: before unzipping, right-click the `.zip` → **Properties** → tick **Unblock**. No
  **Run anyway** at all: Windows 11's Smart App Control or a company policy blocks unsigned programs; that needs a
  signed release.
- **Kural closed unexpectedly / "Kural quit unexpectedly":** the next start saves a crash report and offers **Show
  report** and **Report a bug** (also **Kural: Show Crash Reports**). A common cause: Kural's app was replaced while it
  was still running (an install while Kural was open). `./install.sh` and Kural's own updates now wait until Kural has
  fully closed before replacing it.
- **Mac: the window edges don't show the resize arrows:** this comes from macOS 26 and 27, not from Kural (Kural doesn't
  change the window). macOS made the corners much rounder and moved the area that grabs a corner mostly *outside* the
  window, and on macOS 27 edge resizing fails in other apps too. What works: put the pointer just outside the window's
  edge or corner; double-click the title bar to fill the screen; or **Window → Move & Resize** in the menu bar (halves,
  quarters, fill), also by dragging the window against a screen edge.
- **Mac asks for access to Music, Photos or other folders:** Kural only needs your project folder, and it doesn't look
  into Desktop, Documents, Downloads, Music or Photos by itself; the AI asks you in the chat before it reads a file
  outside the project. So this should only come after you said **Allow** to such a file (or opened that folder as your
  project, or ran something there in the terminal). Otherwise click **Don't Allow**. Things your shell's startup files
  (`~/.zshrc`) do are also put down to Kural when it asks the shell where a program is. If it keeps asking, [report it](https://github.com/adithyakumarcr/kural/issues/new?template=bug_report.yml) with what you
  were doing.
- **Mac asks for your login keychain password ("Kural wants to use … Safe Storage"):** Kural itself keeps nothing
  in the keychain any more, and it turns off VS Code's silent GitHub sign-in checks that caused this at every start (the
  Copilot account lookup; branch protection, avatars and the GitHub login for `git push` in GitHub projects); pushing uses Git's own login, like in
  a terminal. Click **Deny**. If it still appears,
  [report it](https://github.com/adithyakumarcr/kural/issues/new?template=bug_report.yml) with what you were doing.
- **"This client is no longer supported for Gemini Code Assist for individuals":** that's Google's old Gemini CLI,
  which stopped serving personal Google accounts on 26 Sept 2026. Kural's **Google Gemini** uses Google's newer
  Antigravity program instead: Get started → Google Gemini, with the same Google account. See [[Google Gemini and ChatGPT]].
- **An install seems stuck:** the Get started page shows its latest output and how long it has been quiet. **Stop**
  ends it; **Install in a terminal instead** runs the same command where you can see everything.
- **Start over like a new user:** in the source folder, `./install.sh --fresh` (your settings and chats move to a
  backup folder), or `./install.sh --from-scratch-install` (also logs every AI out and resets Kural's macOS
  permissions; nothing is kept).

Still stuck? [Report a bug](https://github.com/adithyakumarcr/kural/issues/new?template=bug_report.yml): what happened, how
to make it happen, what you expected, screenshots, your Kural version and system.

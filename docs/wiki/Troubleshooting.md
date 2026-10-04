# Troubleshooting

- **See what Kural does:** **View → Output → Kural** lists every request, with timings.
- **"Kural: finish setup" in the status bar:** click it. [[Getting Started|Getting Started]] shows which step is missing
  and how to fix it.
- **Claude says I'm not logged in:** click the person icon (Account) → **Log in**.
- **No Tab suggestions:** click **Tab Completion** in the status bar. Is it on? Which engine? "Last suggestion" shows
  whether suggestions arrive and how long they take. With **Local model**, the panel says whether Ollama and the model
  are ready.
- **Terminal suggestions don't show:** they need Kural's terminal with shell integration (bash, zsh, fish, PowerShell)
  and the setting `kural.tabCompletion.terminal` on.
- **A model on my computer is slow:** pick a smaller one, or lower `kural.localModels.contextLength`.
- **Mac says Kural is damaged:** run `xattr -dr com.apple.quarantine /Applications/Kural.app` in Terminal.
- **Mac asks for access to Music, Photos or other folders:** Kural only needs your project folder. Click **Don't Allow**.
  If it keeps asking, [report it](https://github.com/adithyakumarcr/kural/issues/new?template=bug_report.yml) with what you
  were doing.
- **Mac asks for your login keychain password ("Kural wants to use … Safe Storage"):** Kural itself keeps nothing
  in the keychain any more, and it turns off the GitHub integration's silent sign-in checks (branch protection, avatars,
  its own login for `git push`) that caused this in projects cloned from GitHub; pushing uses Git's own login, like in
  a terminal. Click **Deny**. If it still appears,
  [report it](https://github.com/adithyakumarcr/kural/issues/new?template=bug_report.yml) with what you were doing.
- **"This client is no longer supported for Gemini Code Assist for individuals":** that's Google's old Gemini CLI,
  which stopped serving personal Google accounts on 26 Sept 2026. Kural's **Google Gemini** uses Google's newer
  Antigravity program instead: Get started → Google Gemini, with the same Google account. See [[Google Gemini and ChatGPT]].
- **An install seems stuck:** the Get started page shows its latest output and how long it has been quiet. **Stop**
  ends it; **Install in a terminal instead** runs the same command where you can see everything.
- **Start over like a new user:** in the source folder, `./install.sh --fresh` (your settings and chats move to a
  backup folder).

Still stuck? [Report a bug](https://github.com/adithyakumarcr/kural/issues/new?template=bug_report.yml): what happened, how
to make it happen, what you expected, screenshots, your Kural version and system.

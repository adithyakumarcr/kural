# Account and Updates

## Account

The person icon in the status bar (bottom right) shows your Claude plan; hover for who's logged in. Click it for the
Account menu:

- **Who's logged in**: email, plan and organization (for a claude.ai login).
- **See your usage**: opens your usage page in the browser (claude.ai, or the Anthropic Console for an API key).
- **Switch account**: logs out, then opens the login in your browser; log in with the other account. Kural checks the
  new login with a test request and carries on.
- **Log out**: logs Claude Code out on this computer (also in the terminal). Claude models wait until you log in again;
  your own model keeps working.
- **Log in** (when you're logged out).
- **Your own model**: which model on this computer is set up, or set one up.
- **Get started**, **Check for updates**, **Kural guide** (this wiki), **Ask for a feature**.

Kural asks Claude Code who's logged in (`claude auth status`); it never reads your login itself. Also in the Chat panel's
**…** menu, or Command Palette → **Kural: Account**.

## Updates

Kural checks for a new version once a day by itself and offers it in a small notification (**Install and restart**,
**What's new**, **Later**). It never installs without asking. Turn the daily check off with the setting
`kural.updates.autoCheck`.

Check yourself any time: **Help → Check for Updates…**, the Chat panel's **…** menu, or the Account menu.

Updates include test versions (alpha, beta, rc). Installing:

- **Ubuntu**: asks for your password, installs the new `.deb`, restarts Kural.
- **Mac**: replaces Kural.app after Kural quits, then starts it again.
- **Windows**: runs the new setup after Kural quits, then starts it again.

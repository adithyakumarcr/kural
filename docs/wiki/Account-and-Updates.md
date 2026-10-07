# Account and Updates

## AI Usage

**The AI Usage panel** (at the bottom, next to Terminal and Tab Completion; or Command Palette → *Kural: Show AI
Usage*) shows each of your plan's limits in words, with a bar and the time it starts again:

```
Claude   Claude Pro
5-hour limit 50% used          resets in 42 min (Sun 9:24 PM)
Weekly limit 25% used          resets in 3 days 4 h (Thu 12:42 AM)
```

Google Gemini (its weekly limits) and ChatGPT (Codex) (5-hour and weekly) are shown the same way. **Refresh** asks
each program now (for Claude, one tiny request); **usage page** opens the provider's own page.

**The status bar** (bottom right) shows the AI your chat is using in words, the others short:

| Shows | Means |
|---|---|
| `Claude 5h 50% · resets 42m \| Weekly 25% · resets 3d 4h` | the chat's AI: each limit used, and when it resets |
| `Codex 12% · 3%` | another AI you use: its 5-hour and weekly limits used |
| `Gemini 13% · 1%` | Google Gemini: its weekly limits used (Gemini models, other models…) |

**Tokens.** Below each AI's limits, how many tokens it read and wrote today, in the last 7 days and the last 30 days.
"Read" is everything sent to the model (your messages, files, the conversation so far), with how much of it came from
the cache (re-sent text the provider keeps for a few minutes: much cheaper); "written" is what the model produced. It
counts every Kural feature (chat, Tab Completion, Ctrl+K, commit messages), kept for 35 days. A model on your computer shows
its tokens too. Each chat's own tokens and context are next to its send button ([[Chat]]).

It turns orange from 80 % and red from 95 %. Click it for the AI Usage panel. The numbers come from the programs
themselves: Claude Code sends them with every answer (so they update while you work), Codex when Kural asks (every 10
minutes), Gemini from its `/usage`.

## Account

The person icon next to it shows the name on the account the chat's AI uses (for example "Peasant Adithya"); hover
for who's logged in where. (The name comes from what Claude Code, Gemini or Codex saved on your computer at login, and
only when it belongs to the same account; otherwise the email shows.) Click it for **Kural Settings**, an
editor tab (also the Chat panel's **...** menu, or **Kural: Settings**). It has a card each for Claude, Google Gemini,
ChatGPT (Codex) and your own model:

- **Who's logged in**: email, plan, organization.
- **Usage**: the meter's numbers; and **Usage page**, which opens the provider's own usage page in your browser.
- **Switch account**: logs out, then starts the login again; log in with the other account. Kural checks the new login
  with a test request and carries on.
- **Log out**: logs that program out on this computer (also in the terminal). Its models wait until you log in again;
  the others keep working.
- **Log in** (when you're logged out), or **Set up** (when you haven't yet).
- **Your own model**: which model on this computer is set up, or set one up.
- **Get started**, **Check for updates**, **Kural guide** (this wiki), **Ask for a feature**.
- **Export settings / Import settings**: your Kural preferences to a file and back (another computer, a fresh
  install). You choose what goes in: Kural's settings (not program paths: they differ per computer), your editor settings
  and keyboard shortcuts, the extensions you installed (installed again on import), chat defaults, saved devices (names
  and addresses; no keys or passwords: each device needs **Set up again** once). Importing shows what the file has and
  applies what you tick; shortcuts are added to yours. Also **Kural: Export Settings** / **Kural: Import Settings**.
- **Crash reports**: see below.

Kural asks the programs who's logged in (`claude auth status`, Codex's account info, Antigravity's `/model`); it never
reads your login itself. Also in the Chat panel's **…** menu, or Command Palette → **Kural: Account**.

## Updates

Kural checks for a new version once a day by itself and offers it in a small notification (**Install and restart**,
**What's new**, **Later**). It never installs without asking. Turn the daily check off with the setting
`kural.updates.autoCheck`.

Check yourself any time: **Help → Check for Updates…**, the Chat panel's **…** menu, or **Check for updates** in Kural
Settings (with the switch for the daily check). Kural Settings also links to Get started, Tab Completion, all of Kural's
settings, Kural's log, the guide, and asking for a feature.

Updates include test versions (alpha, beta, rc). Installing:

- **Ubuntu**: asks for your password, installs the new `.deb`, restarts Kural.
- **Mac**: replaces Kural.app after Kural has fully closed, then starts it again.
- **Windows**: runs the new setup after Kural has fully closed, then starts it again.

Fully closed: Kural and every helper it started. Replacing the app while any part of it still ran made Kural crash on
the way out and sometimes not start again. If something keeps Kural open (an unsaved file, a running task), Kural says
so; the update finishes when you close it. On a Mac the old app is set aside first and comes back if the new one can't
be put in place, and Kural checks first that it may replace itself (an app installed by another user of the Mac can't
be: Kural shows the download to install by hand). What the install did is written to `update.log` in Kural's storage;
if it didn't finish, Kural says so at the next start.

## Crash reports

When Kural closed unexpectedly (it crashed, was forced to quit, or the computer turned off), the next start writes a
report on your computer and says so (**Show report**, **Report a bug**). It comes from what the computer kept:

- **which windows ended unexpectedly** (each Kural window notes when it starts and when it closes normally),
- **macOS's crash reports** for Kural and its helpers (`~/Library/Logs/DiagnosticReports`): what kind of crash, which
  thread, its top frames,
- **VS Code's own logs** of that session: the lines saying a window, the extension host or the GPU process went away,
  and the last errors before the end,
- and errors in Kural's own code that nothing caught (`kural-errors.log`).

**Report a bug** copies the report and opens the bug form: paste it there (check it first: it has file paths from your
computer). Nothing is sent by Kural itself. All reports: **Kural: Show Crash Reports** or **Crash reports** in Kural
Settings.

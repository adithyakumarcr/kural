# Account and Updates

## AI Usage

**The AI Usage panel** (at the bottom, next to Terminal and Tab Completion; or Command Palette → *Kural: Show AI
Usage*) shows a compact summary for each AI: its most used limit, a bar and when it resets:

```
Claude
Session 50% used          resets in 42 min
Weekly 20% used           resets in 4 days
Tokens
```

**Session** is the short limit, 5 hours long (Claude's and Codex's); **Weekly** is the week's. Each AI's Session and
Weekly limits are always shown, with when they reset. Google Gemini has only weekly limits (one per model family:
"Weekly (Gemini)"). Only the token table is collapsed: click **Tokens** to open it. **Refresh** asks each program now
(for Claude, one tiny request); **Settings** opens the AI accounts in Kural Settings, with the automatic switching controls.

**The status bar** (bottom right) shows only each AI's **Session** limit: the AI your chat is using in words, the
others short. Hover it for everything: every AI's Session and Weekly limits and when each resets.

| Shows | Means |
|---|---|
| `Claude Session 50% · resets 42m` | the chat's AI: its Session limit used, and when it resets |
| `Codex 12%` | another AI you use: its Session limit used |
| `Claude Session 10% · resets 42m` with a warning color | a Weekly limit is near its limit; hover for its percentage and reset time |
| `Gemini` | Google Gemini has only weekly limits: hover for its usage |

**Tokens.** Under **Tokens**, how many tokens it read and wrote today, in the last 7 days and the last 30 days.
"Read" is everything sent to the model (your messages, files, the conversation so far), with how much of it came from
the cache (re-sent text the provider keeps for a few minutes: much cheaper); "written" is what the model produced. It
counts every Kural feature (chat, Tab Completion, Ctrl+K, commit messages), kept for 35 days. A model on your computer shows
its tokens too. Each chat's own tokens and context are next to its send button ([[Chat]]).

It turns orange from 80 % and red from 95 %. Click it for the AI Usage panel. The numbers come from the programs
themselves: Claude Code sends them with every answer (so they update while you work), Codex when Kural asks (every 10
minutes), Gemini from its `/usage`.

### Switching AI near a limit

On each AI's page in **Kural Settings** (**Settings** on its card, or the gear in the model menu), turn on **Switch to
another AI near a limit**. It is off by default.

Then that AI's page sets its own switch points: "Move the chat to another AI when the Session limit is [70] % used or
a Weekly limit is [70] % used". Each is editable from **1% to 99%**, and the default is **70%**. Gemini has a Weekly
point only.

When a reported Session or Weekly limit for the current model reaches its point, Kural moves the **same chat**
to another service you have set up that is below its points. This works with a model picked by hand and with **Auto**.
Messages, attached context, tool results, changes, answered questions and the plan go along. A paused request continues
on the next service; a completed answer switches before the next message. Active tools, approvals, background tasks
and agents finish before the handoff. The new service must support the chat's attachments, team or linked device.

If none can take over, the chat stays with its current service. Providers may report usage only after a request, so
the points are a switching trigger and cannot guarantee that usage stops at exactly that percentage. Turning the switch
off keeps your current model choice; **Auto** retains its existing routing and usage-limit recovery.

## Account

The person icon next to it shows the name on the account the chat's AI uses (for example "Peasant Adithya"); hover
for who's logged in where. (The name comes from what Claude Code, Gemini or Codex saved on your computer at login, and
only when it belongs to the same account; otherwise the email shows.) Click it for **Kural Settings**, an
editor tab (also the Chat panel's **...** menu, or **Kural: Settings**). It is a short overview: a card each for Claude,
Google Gemini, ChatGPT (Codex) and your own model:

- **Who's logged in**: email, plan, organization.
- **Usage**: the meter's numbers; and **Usage page**, which opens the provider's own usage page in your browser.
- **Settings**: opens that AI's own page. The model menu's gear opens the same page.
- **Log in / log out / switch account / set up**, as below.

Each AI's page has:

- **Connectors** (Claude and ChatGPT (Codex)): the list with each one's status, **Sign in** when one needs it, and remove.
  **Add connector** opens a searchable list (Popular ones and the official MCP directory). For Claude, the **Use my
  Claude Code setup** checkbox and **Reload** are there too. See [[Chat]] and [[Google Gemini and ChatGPT]].
- **Switch to another AI near a limit**: when to move a chat to another AI (Session and Weekly, see above).
- **Your own model** (on its page): **Find & download models…** (see [[Your Own Model]]), change model, context length.

The card's other actions:

- **Switch account**: logs out, then starts the login again; log in with the other account. Kural checks the new login
  with a test request and carries on.
- **Log out**: logs that program out on this computer (also in the terminal). Its models wait until you log in again;
  the others keep working.
- **Log in** (when you're logged out), or **Set up** (when you haven't yet).
- **Get started**, **Check for updates**, **Kural guide** (this wiki), **Ask for a feature**.
- **Moods**: the chat's moods. The four built-in ones, and your own: **Add a mood** (name, a one-line hint,
  instructions for the AI), with tips on what works best and examples to start from; **Edit** and delete them. See
  [[Chat]].
- **Export settings / Import settings**: your Kural preferences to a file and back (another computer, a fresh
  install). You choose what goes in: Kural's settings (not program paths: they differ per computer), your editor settings
  and keyboard shortcuts, the extensions you installed (installed again on import), chat defaults, saved devices (names
  and addresses; no keys or passwords: each device needs **Set up again** once). Importing shows what the file has and
  applies what you tick; shortcuts are added to yours. Also **Kural: Export Settings** / **Kural: Import Settings**.
- **Crash reports**: see below.

Kural asks the programs who's logged in (`claude auth status`, Codex's account info, Antigravity's `/model`); it never
reads your login itself. Also in the Chat panel's **…** menu, or Command Palette → **Kural: Account**.

## What Kural learns

Kural Settings → **What Kural learns**: **Tab Completion learns from your work** (off by default) and **Auto learns
which models you prefer** (on by default). Switch either off, or press **Delete what it learned** (it asks once, on the
same row). Both stay on this computer.

## Updates

Kural checks for a new version once a day by itself and offers it in a small notification (**Install and restart**,
**What's new**, **Later**). It never installs without asking. Turn the daily check off with the setting
`kural.updates.autoCheck`.

After an update, the first start opens **What's New in Kural**: the release notes of every version since the one you
had (also when you installed the new version yourself). Open it again any time: Command Palette → **Kural: What's New**.

Check yourself any time: **Help → Check for Updates…**, the Chat panel's **…** menu, or **Check for updates** in Kural
Settings (with the switch for the daily check). Kural Settings also links to Get started, Tab Completion, all of Kural's
settings, Kural's log, the guide, and asking for a feature.

Before installing, Kural checks the download against the release's signed checksum list (`SHA256SUMS`, signed with
Kural's release key). A release without that list is not installed automatically: download it from the releases page.
**Kural: Verify this installation...** (Command Palette) checks the list of the version you run. See
`docs/release-signing.md` in the repository for checking a download by hand.

Updates include test versions (alpha, beta, rc). Installing:

- **Ubuntu**: asks for your password, installs the new `.deb`, restarts Kural.
- **Mac**: replaces Kural.app after Kural has fully closed, then starts it again. The new app is first copied next to
  the old one, and checked whole (the Electron Framework and the four helper apps) before anything is replaced. The old
  app stays in place until the new one is there and checked; if anything fails, the old Kural stays.
- **Windows**: runs the new setup after Kural has fully closed, then starts it again.

Fully closed: Kural and every helper it started. Replacing the app while any part of it still ran made Kural crash on
the way out and sometimes not start again. If something keeps Kural open (an unsaved file, a running task), Kural says
so; the update finishes when you close it. On a Mac, Kural checks first that it may replace itself (an app installed
by another user of the Mac can't be: Kural shows the download to install by hand), and the old app goes back if the
new one can't be put in place. What the install did is written to `update.log` in Kural's storage;
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

## Profiles (personal and work)

A profile is a separate set of AI accounts: one for your own projects and one for your job, each logged in to a
different Claude or ChatGPT account.

- The status bar shows the current profile (an icon and its name). Click it to switch, make a new one, or manage them.
  **Kural: Switch Profile…**, **New Profile…** and **Manage Profiles…** are in the Command Palette too.
- Switching reloads the window, so every program starts again with the other account. If a chat is still answering,
  Kural asks first. Other open Kural windows keep their profile until you reload them.
- **New profile:** choose Personal or Work, give it a name, and choose whether it shares chats. A new profile has no
  logins yet, so Get started opens and you log in to its Claude and ChatGPT accounts there.
- **Share or keep separate:** a sharing profile shows the same chats, History, open tabs and Tab Completion memory as
  your main profile; a separate one has its own. Change it in Manage profiles. Logins and usage numbers are always
  separate. A shared chat started under one account continues under the other as a new conversation, with the earlier
  messages handed over.
- **On a Mac** a new profile needs Claude Code 2.1.296 or newer (run `claude update`): older versions keep one login
  for the whole computer.
- **Same in every profile:** Google Gemini (it has no setting for a second account) and models on your computer.
- **Manage profiles:** rename, share or stop sharing, delete (not the main profile, not the one in use). Deleting removes
  its logins, and its own chats if it didn't share.
- If `CLAUDE_CODE_OAUTH_TOKEN` or an API key is set in your environment, every profile uses it.

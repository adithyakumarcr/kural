# Account and Updates

## The usage meter

The status bar (bottom right) shows how much of your plan you've used:

| Shows | Means |
|---|---|
| `Claude 45% · 24%` | Claude: 45 % of the 5-hour limit and 24 % of the weekly limit used |
| `Codex 12% · 3%` | ChatGPT (Codex): the same two limits |
| `Antigravity 13% · 1%` | Antigravity: its weekly limits used (Gemini models, Claude models…) |
| `Gemini 1.2M tok` | Gemini: tokens used today (Gemini CLI doesn't report a share of a limit) |

It turns orange from 80 % and red from 95 %. Hover for when each limit resets. The numbers come from the programs
themselves: Claude Code sends them with every answer (so they update while you work), Codex when Kural asks (every 10
minutes). To get Claude's numbers right now, Account menu → the usage line (one tiny request to Claude).

## Account

The person icon next to it shows your Claude plan; hover for who's logged in where. Click it for the Account menu, with
a section each for Claude, ChatGPT (Codex), Antigravity and Gemini:

- **Who's logged in**: email, plan, organization.
- **Usage**: the meter's numbers; and **Usage page**, which opens the provider's own usage page in your browser.
- **Switch account**: logs out, then starts the login again; log in with the other account. Kural checks the new login
  with a test request and carries on.
- **Log out**: logs that program out on this computer (also in the terminal). Its models wait until you log in again;
  the others keep working.
- **Log in** (when you're logged out), or **Set up** (when you haven't yet).
- **Your own model**: which model on this computer is set up, or set one up.
- **Get started**, **Check for updates**, **Kural guide** (this wiki), **Ask for a feature**.

Kural asks the programs who's logged in (`claude auth status`, Codex's account info, Gemini CLI's own files); it never
reads your login itself. Also in the Chat panel's **…** menu, or Command Palette → **Kural: Account**.

## Updates

Kural checks for a new version once a day by itself and offers it in a small notification (**Install and restart**,
**What's new**, **Later**). It never installs without asking. Turn the daily check off with the setting
`kural.updates.autoCheck`.

Check yourself any time: **Help → Check for Updates…**, the Chat panel's **…** menu, or the Account menu.

Updates include test versions (alpha, beta, rc). Installing:

- **Ubuntu**: asks for your password, installs the new `.deb`, restarts Kural.
- **Mac**: replaces Kural.app after Kural quits, then starts it again.
- **Windows**: runs the new setup after Kural quits, then starts it again.

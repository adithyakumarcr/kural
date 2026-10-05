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

It turns orange from 80 % and red from 95 %. Click it for the AI Usage panel. The numbers come from the programs
themselves: Claude Code sends them with every answer (so they update while you work), Codex when Kural asks (every 10
minutes), Gemini from its `/usage`.

## Account

The person icon next to it shows your Claude plan; hover for who's logged in where. Click it for **Kural Settings**, an
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
- **Mac**: replaces Kural.app after Kural quits, then starts it again.
- **Windows**: runs the new setup after Kural quits, then starts it again.

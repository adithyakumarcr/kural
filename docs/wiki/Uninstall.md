# Uninstall Kural

Uninstalling removes the program. What Kural keeps for you stays unless you remove it: your chats and History,
checkpoints (copies of files from before the AI changed them), settings, Kural's SSH key for your devices (and that
key on each device), the logins of your other profiles, connector keys, and Kural's approval gate in Google Gemini's
(Antigravity's) settings. So remove Kural's data first, then the program.

## 1. Remove Kural's data (while Kural still runs)

Command Palette → **Kural: Remove Kural's Data...**. Pick what goes (for uninstalling: all of it):

- **Take Kural's key off your devices**: the line Kural added to `~/.ssh/authorized_keys` on each device you linked.
  A device that can't be reached keeps it: remove the line ending in `kural@…` there yourself.
- **Take Kural's approval gate out of Google Gemini**: the entry `kural-gate` in `~/.gemini/config/hooks.json`. Your
  own entries stay. (Left in place it does nothing without Kural, but it's Kural's.)
- **Remove the connectors whose key Kural keeps**: connectors you added in Kural Settings with a token. They stop
  working once Kural's folder is gone, so they're removed from Claude Code and Codex too.
- **Log out your other profiles**: the Claude and ChatGPT logins of profiles other than your main one.
- **Then close Kural and delete everything it keeps on this computer**: once every Kural window has closed, a small
  script deletes Kural's folders (below). What it did is in `kural-removed-<date>.log` in your temp folder.

Claude Code, Codex, Antigravity and Ollama are programs of their own: they and their logins stay (step 3).

## 2. Remove the program

- **Mac**: drag **Kural** from Applications to the Trash.
- **Ubuntu**: `sudo apt remove kural`
- **Windows**: Settings → Apps → Kural → Uninstall. Tick **Your Kural data** to delete your settings and chats too
  (off by default). Close Kural first: the uninstaller says so if it's still running. Silent: `"Uninstall Kural.exe" /S`
  (add `/REMOVEDATA` for your data).

## 3. Other programs (only if you don't want them)

Kural's Get started may have installed these. Remove them only if you don't use them without Kural:

- **Claude Code**: `claude` (see Anthropic's docs; installed with npm: `npm uninstall -g @anthropic-ai/claude-code`).
- **Codex**: `npm uninstall -g @openai/codex` (or `brew uninstall codex`).
- **Antigravity** (`agy`): see Google's instructions.
- **Ollama** and its models: on a Mac, quit Ollama and drag it from Applications to the Trash (models: `~/.ollama`); on
  Ubuntu it runs as a service: `sudo systemctl disable --now ollama`, then remove it as ollama.com describes; on Windows,
  Settings → Apps → Ollama.

## By hand (if Kural doesn't start any more)

| | Kural's folders |
|---|---|
| **Mac** | `~/Library/Application Support/Kural`, `~/.kural`, `~/.kural-shared`, `~/Library/Caches/com.kural`, `~/Library/Saved Application State/com.kural.savedState`, `~/Library/Preferences/com.kural.plist`, `~/Library/Logs/Kural`; Keychain Access: the item "Kural Safe Storage" |
| **Ubuntu** | `~/.config/Kural`, `~/.kural`, `~/.kural-shared` |
| **Windows** | `%APPDATA%\Kural`, `%USERPROFILE%\.kural`, `%USERPROFILE%\.kural-shared` |

Also: the entry `kural-gate` in `~/.gemini/config/hooks.json` (and the file `hooks.json.kural-backup` beside it), and
on each device you linked, the line ending in `kural@…` in `~/.ssh/authorized_keys`.

# Devices (SSH)

Working on a Raspberry Pi, a robot's board computer or any Linux machine on your network? Save it in Kural once, link it
to a chat, and the AI can work on it: run commands, read and write files. You can also open a terminal on it with one
click.

## Add a device

In the chat: **+ → Link device → Add a device…**

| Field | Example |
|---|---|
| Name | `rpi-lab` (what you call it in Kural) |
| Address | `192.168.1.20` or `raspberrypi.local` (`pi@raspberrypi.local:2222` works too) |
| Username | `pi` |
| Port | `22` (the usual one) |
| Password | the user's password on the device |

**Connect & save** logs in once to check, then saves it. If it fails, Kural says why in plain words (wrong password, no
device with that name, SSH not turned on…). On a Raspberry Pi, turn SSH on with `sudo raspi-config` → Interface
Options → SSH.

## Where the password is kept

Encrypted, by your computer's own keychain, through VS Code's secret storage: the macOS Keychain, Windows' Credential
Manager, or the Secret Service (GNOME Keyring / KWallet) on Linux. It is never in a file, a setting or a chat, and it's
never sent to an AI. `ssh` gets it only when it asks for it (through a small helper, `SSH_ASKPASS`), never on its command
line.

- **Mac:** after updating Kural, macOS may ask once whether Kural may use its "Safe Storage" key: **Always Allow**.
- **Linux without a keyring** (some minimal desktops): VS Code asks whether to use weaker encryption instead. Install
  GNOME Keyring (or KWallet) for real encryption.

## Use it in a chat

Pick the device in **+ → Link device**; its chip shows above the input (click it for a terminal on the device; × to
unlink). Then ask in plain words: "what's using the CPU on the Pi?", "copy this script to the board and run it",
"read the log in /var/log/robot.log and tell me why it crashed".

- **Agent mode:** Kural asks before each command and each file write on the device ("Run this on rpi-lab?"). Reading
  files and listing folders just happen. **Allow everything on rpi-lab in this chat** on that card stops the asking for
  this device until you unlink it. (Allowing all commands on your own computer doesn't cover the device.)
- **Auto mode:** commands and writes run without asking.
- **Plan and Ask modes:** nothing is run or changed on the device.
- Works with Claude, ChatGPT (Codex) and Gemini models. A model on your own computer (Ollama) can't use a device yet.
- Each command is its own shell: `cd` doesn't carry over (the AI knows). Programs that never end (a server) should be
  started in the background. A command has a time limit (2 minutes unless the AI asks for more, at most 30); when it
  runs out, the command is stopped on the device too. Stop, or unlinking the device, stops it at once.

The first connection trusts the device's key and remembers it (like answering "yes" in a terminal). If the key changes
later (you reinstalled the device, a new SD card), Kural refuses to connect, because someone could be pretending to be
your device. If you expected it: **Kural: Devices** → the device → **Forget its key**.

## Manage devices

Command Palette → **Kural: Devices (SSH)**: pick a device to open a terminal on it, link it to the current chat, change
its password, forget its key, or remove it. **Kural: Add a Device (SSH)** adds one with a few questions.

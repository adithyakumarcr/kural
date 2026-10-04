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

**Connect & save** logs in once with the password, puts Kural's own SSH key on the device, checks that the key works,
and saves the device. The password isn't saved. If it fails, Kural says why in plain words (wrong password, no
device with that name, SSH not turned on…). On a Raspberry Pi, turn SSH on with `sudo raspi-config` → Interface
Options → SSH.

## The password isn't kept

Kural logs in to your devices with its own SSH key, the way developers usually set up SSH (like `ssh-copy-id`):

- When you add a device, the password is used **once**: Kural logs in with it and adds Kural's public key to the
  device's `~/.ssh/authorized_keys`. Then the password is forgotten. It's never saved: not in a file, not in a setting,
  not in your computer's keychain, and never sent to an AI. (`ssh` gets it through a small helper, `SSH_ASKPASS`, never
  on its command line.)
- From then on Kural logs in with the key. The key pair is Kural's own (one for all your devices), made by `ssh-keygen`
  and readable only by you.
- Nothing asks for your computer's password or keychain (an earlier version kept the password in the keychain, and the
  Mac asked for your login password, again after every update).
- **Remove** takes Kural's key off the device again (when the device is reachable, and no other saved device uses
  the same login).
- A device saved by an earlier version asks for its password once more (**Set up again**), then uses the key.

## Use it in a chat

Pick the device in **+ → Link device**; its chip shows above the input (click it for a terminal on the device; × to
unlink). Then ask in plain words: "what's using the CPU on the Pi?", "copy this script to the board and run it",
"read the log in /var/log/robot.log and tell me why it crashed".

- **Agent mode:** Kural asks before each command and each file write on the device ("Run this on rpi-lab?"). Reading
  files and listing folders just happen. **Allow everything on rpi-lab in this chat** on that card stops the asking for
  this device until you unlink it. (Allowing all commands on your own computer doesn't cover the device.)
- **Auto mode:** commands and writes run without asking.
- **Plan and Ask modes:** nothing is run or changed on the device.
- Works with Claude, ChatGPT (Codex) and Gemini models. Not with Antigravity (it can't ask before running a command)
  or a model on your own computer (Ollama).
- Each command is its own shell: `cd` doesn't carry over (the AI knows). Programs that never end (a server) should be
  started in the background. A command has a time limit (2 minutes unless the AI asks for more, at most 30); when it
  runs out, the command is stopped on the device too. Stop, or unlinking the device, stops it at once.

The first connection trusts the device's own key (its "host key") and remembers it (like answering "yes" in a
terminal). If it changes later (you reinstalled the device, a new SD card), Kural refuses to connect, because someone
could be pretending to be your device. If you expected it: **Kural: Devices** → the device → **Forget its key**, then
**Set up again** (a reinstalled device has lost Kural's key too).

## Manage devices

Command Palette → **Kural: Devices (SSH)**: pick a device to open a terminal on it, link it to the current chat, change
**Set up again** (asks the password once, to put Kural's key back), forget its host key, or remove it. **Kural: Add a Device (SSH)** adds one with a few questions.

# Fix with Kural

A red or yellow squiggle in the editor, or a command that failed in the terminal: one click puts the problem into the
chat, with the code around it, so the AI can fix it. Like Cursor's "Fix in Chat". Kural never sends it by itself: you
read the message and press **Send**.

## In the editor

Put the cursor on an error or warning and open the light bulb (**Ctrl+.** on Windows and Linux, **Cmd+.** on a Mac).
Choose **Fix with Kural**. The chat opens with a pill for the problem and the words "Fix this." after it.

- The pill holds the file and line, whether it's an error or a warning, the message, which tool found it (for example
  `ts 2304`), and the problem's lines with three lines of code above and below, numbered.
- With two or more problems in the file, **Fix all problems in this file with Kural** is there too. It adds up to 25 of
  them, in line order, each with its own piece of code.
- Hints and information messages don't get the action: only errors and warnings.
- Edit the words after the pill if you want to ask something else ("Fix this without changing the types").

## In the terminal

When a command ends with an error (an exit code that isn't 0), a button **Fix with Kural** (a wand) shows in the status
bar at the bottom for 15 seconds. Click it and the chat gets the command, the folder it ran in, the exit code and the
last 8,000 characters of its output, without colors.

Later, **Kural: Fix the Last Failed Command** (Command Palette) or **Fix the Last Failed Command** in the terminal's
right-click menu does the same for the active terminal. If that terminal has no failed command, Kural says so.

> [!NOTE]
> This needs the terminal's **shell integration**, which VS Code turns on by itself for bash, zsh, fish and
> PowerShell. In a terminal without it, Kural can't see where a command ends or what its exit code was.

## Good to know

- Nothing leaves your computer until you press Send, and then it goes to the AI you picked, like any message.
- **Agent Review** uses the same way into the chat: its **Fix in Chat** button adds a finding as a pill. See
  [[Agent Review]].
- The chat's mode decides what the AI may do about it: in **Agent** it fixes the code and asks before commands; in **Ask**
  it only explains.

See also [[Chat]] and [[Terminal]].

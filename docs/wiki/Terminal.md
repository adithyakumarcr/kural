# Terminal

In Kural's terminal, Kural suggests a whole command line in the terminal's suggestion list. **Tab** puts it on your
command line; nothing runs until you press **Enter**.

The initial **Show suggestions / don't show this again** hint is hidden by default. Suggestions still appear while
you type; **Ctrl+Space** opens them manually.

## Finishing a command

Start a command and Kural suggests the rest, from your recent commands, `git status` and what you've been doing in this
workspace. It uses Tab Completion's engine and model (see [[Tab Completion]]).

## Commit messages

Type `git commit -m "` and Kural reads your staged changes (or the unstaged ones if nothing is staged) and suggests a
message that says what changed and why, in the style of your earlier commits. Commit messages come from the chat's
model.

## Plain words → a command

Write what you want in your own words, and Kural suggests the command:

| You type | Kural suggests |
|---|---|
| `push this code to fix/code-editor branch` | `git push origin HEAD:fix/code-editor` |
| `commit with message please added the low stock check` | `git commit -m "Added the low stock check"` |
| `i want to delete the file install.sh` | `rm install.sh` |
| `rename notes.md to todo.md` | `mv notes.md todo.md` |

Kural notices plain words (a sentence, not a command: no options or shell symbols, and words like "this", "the",
"please"; after a program name such as `git` it needs at least two of them; or starting with a verb like "delete",
"rename" or "remove" that isn't a program) and asks the chat's model when you pause, also in the middle of a word. Its
suggestion comes first in the list, so Tab takes it. The model gets your
current branch and remotes. Kural tells the model to avoid destructive options (like `rm -rf` or `push --force`), but
it's a model: read the suggestion before you press Enter.

## Turning it off

Setting `kural.tabCompletion.terminal`, or Tab Completion off altogether (**Ctrl+Alt+Space**).

# Tab Completion

Grey suggestions as you type, and when you place the cursor (also in the middle of a line). **Tab** accepts; keep
typing to ignore it. Write a comment, press Enter, and the suggestion implements it.

## The Tab Completion panel

Click the **sparkle** icon in the status bar (bottom right) to turn suggestions **on or off**. It is crossed out while
off, and remains an icon during setup or errors; hover for details. **Ctrl+Alt+Space** toggles it too (Ctrl on Mac).

Open its panel from **Tab Completion settings** in the icon's hover, **Kural Settings → Tab Completion**, or the
Command Palette → **Tab Completion**. There you can:

- turn it **on or off** (also **Ctrl+Alt+Space**, Ctrl on a Mac too),
- set **how fast it suggests**: Instant (as you type) to Slow (waits longer after your last key),
- pick the **engine**:
  - **Auto**: the model on your computer gets a head start, Claude races it, the first good answer wins;
  - **Local model**: the model on your computer (fastest: about 150–300 ms, offline);
  - **Claude**: always Claude (Haiku is fastest, about 0.6–0.9 s),
- pick the **model** for that engine (the panel shows only the choices for the engine you picked),
- see how long the **last suggestion** took, and which engine made it.

**While a chat answers with a model on your computer**, Ollama runs both models on the same graphics chip, and Tab's
local answers get several times slower (2–3 s instead of 0.3 s; up to 6 s while Ollama loads the chat's model). So
then, if Claude is set up, Claude helps: the local model still gets a short head start, and the first good answer wins
(the slower request is stopped, so it doesn't slow the chat down). Kural also notices when the local answers are much
slower than usual for other reasons (a chat in another window, another app) and does the same for 20 seconds. Without
Claude, Tab waits a little longer between your keys while Ollama is busy, so fewer requests compete with the chat.

The local model is a small fill-in-the-middle code model through Ollama (`qwen2.5-coder` 0.5B, 1.5B or 3B; 1.5B is a
good start). **Set up** in the panel does it all in one click: without Ollama, Kural downloads and installs Ollama first
(the panel shows "Step 1 of 2: Downloading Ollama… 45%", then "Installing Ollama… 60%"; on Ubuntu the system asks for
your password, since Ollama installs for the whole computer), then downloads the model ("Step 2 of 2"). Kural uses a model on your computer only after you chose
one: **Set up** in the panel (or your own model set up in Get started). A model that's already there from before isn't
used until then, and the panel says "Not set up".

## When you change a name

Change the name of something in your code (type over it, or accept a Tab suggestion that changes it), and once you're
done with that word (you move on, or pause for a moment), Kural looks for the old name in the rest of the project:

> "count" became "total" here. Also change it in this file (2 places) and 3 other files (7 places)?

- **Review** opens [[Search & Ask|Search and Ask]] filled in: the old name with Match Case and Match Whole Word, the new
  one in Replace. You see every place and replace them one by one, per file, or all at once.
- **Change all** changes every place in one go (Ctrl+Z undoes it). Files you weren't editing are saved; the one you're
  in stays unsaved.
- **Not now** leaves everything as it is.

Only whole words with the same capitals count (`countAll` and `Count` aren't `count`). Not searched: `node_modules`,
`dist`, `build`, minified and lock files, and prose files (`.md`, `.txt`: a README's "the count of items" isn't your
variable). Not offered: a new name you're typing, keywords (`let` → `const`), one-letter names, edits made with several
cursors at once (that's already a rename). It searches text, so a different variable with the same name in another file
shows up too: use **Review** when you're not sure. Off: setting `kural.tabCompletion.renameAcrossFiles`.

## It learns from your work

The models never change, so with each suggestion Kural tells them what you've been doing in this workspace: what you
asked the chat and which files it changed, Ctrl+K and Apply changes you accepted, suggestions you accepted, the file
you just edited, and the commands you run. So suggestions fit your current task and style. It's kept only on this
computer, per workspace; commands with passwords or tokens are never kept. To clear it: Command Palette → **Kural:
Forget What Tab Completion Learned (This Workspace)**.

## Settings

| Setting | Default | |
|---|---|---|
| `kural.tabCompletion.enabled` | on | suggestions on/off |
| `kural.tabCompletion.debounceMs` | 75 | ms to wait after your last key |
| `kural.tabCompletion.engine` | auto | auto / local / claude |
| `kural.tabCompletion.localModel` | qwen2.5-coder:1.5b-base | the Ollama model |
| `kural.tabCompletion.model` | haiku | the Claude model |
| `kural.tabCompletion.terminal` | on | Tab in the terminal too (see [[Terminal]]) |
| `kural.tabCompletion.renameAcrossFiles` | on | after you change a name, offer to change it where else it's used |

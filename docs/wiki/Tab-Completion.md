# Tab Completion

Grey suggestions as you type, and when you place the cursor (also in the middle of a line). **Tab** accepts; keep
typing to ignore it. Write a comment, press Enter, and the suggestion implements it.

## The Tab Completion panel

Click the **sparkle** icon in the status bar (bottom right; its hover says Tab Completion, and it's crossed out while
Tab Completion is off). There you can:

- turn it **on or off** (also **Ctrl+Alt+Space**, Ctrl on a Mac too),
- set **how fast it suggests**: Instant (as you type) to Slow (waits longer after your last key),
- pick the **engine**:
  - **Auto**: the model on your computer gets a head start, Claude races it, the first good answer wins;
  - **Local model**: always the model on your computer (fastest: about 150–300 ms, offline);
  - **Claude**: always Claude (Haiku is fastest, about 0.6–0.9 s),
- pick the **model** for that engine (the panel shows only the choices for the engine you picked),
- see how long the **last suggestion** took, and which engine made it.

The local model is a small fill-in-the-middle code model through Ollama (`qwen2.5-coder` 0.5B, 1.5B or 3B; 1.5B is a
good start). **Set up** in the panel does it all in one click: without Ollama, Kural downloads and installs Ollama first
(the panel shows "Step 1 of 2: Downloading Ollama… 45%", then "Installing Ollama… 60%"; on Ubuntu the system asks for
your password, since Ollama installs for the whole computer), then downloads the model ("Step 2 of 2"). Kural uses a model on your computer only after you chose
one: **Set up** in the panel (or your own model set up in Get started). A model that's already there from before isn't
used until then, and the panel says "Not set up".

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

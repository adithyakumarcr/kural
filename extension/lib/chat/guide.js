// What Kural can do and how to use it, for the chat model: when someone asks "how do I…?", "can Kural…?" or "where
// is…?", the chat answers from this. Keep it short (it goes with every chat) and true: when you add, change or remove a
// feature, change it here and in the wiki (docs/wiki/) in the same commit. No vscode here.

const ISSUES = "https://github.com/adithyakumarcr/kural/issues/new?template=feature_request.yml";
const WIKI = "https://github.com/adithyakumarcr/kural/wiki";

const GUIDE = `

About Kural (use this when the user asks about Kural itself: a feature, a setting, how to do something in the editor):
Kural is a code editor (VSCodium, the open-source VS Code, so VS Code's own features, settings and extensions work)
with an AI assistant built in. Its AI comes from Claude (Claude Code with the user's Claude plan), Google Gemini
(Google's Antigravity CLI with a Google account: free, AI Pro, Ultra; Google's Gemini CLI is no longer used: Google
stopped personal accounts there on 26 Sept 2026), ChatGPT (OpenAI's Codex CLI with a ChatGPT plan), or the user's own
model on their computer (Ollama, offline, no account). Features and how to use them:
- Welcome (Command Palette: "Kural: Welcome", also Help → Welcome): opens by default when there are no editors to
  restore. Start has New File, Open File, Open Folder and Clone Git Repository; Recent reopens projects;
  Walkthroughs includes "Get started with Kural" (AI setup, a project, chat, theme), "Learn the Fundamentals" and
  installed extensions' guides. "Show welcome page on startup" at the bottom turns it on/off. It doesn't open by itself
  when Kural restores files from last time: use Help → Welcome. Closing the last editor tab opens it again (not when
  that tab was Welcome; setting kural.welcomeWhenEmpty). Kural has no VSCodium walkthrough or announcements,
  and Help → Report Issue goes to Kural's GitHub issues.
- Get started (Command Palette: "Kural: Get Started"): pick Claude, Google Gemini, ChatGPT (Codex) or your own model;
  Kural checks each step (install, log in or download a model, a test request). Any one is enough; all can be set up.
  "Install for me" installs in the background (Gemini: Google's Antigravity installer, or "Update for me" (agy update)
  when an Antigravity older than 1.3.4 is there; Codex: Homebrew or npm,
  whichever the computer has, else it points to Node.js's installer) and shows what it's doing on the page (its output,
  time, a warning when it goes quiet; Stop); any question the installer asks comes as a pop-up. "Log in": Codex opens
  the login page in the browser; Gemini (Antigravity) only logs in on its own screen, so Kural runs it in a terminal,
  opens Google's login page itself, asks for the code Google shows (a pop-up) and types it in, and closes the screen
  when you're logged in.
- Gemini (Antigravity): Kural adds an approval gate to Antigravity's own hooks (an entry "kural-gate" in
  ~/.gemini/config/hooks.json; your own entries stay), so Gemini asks Kural before each tool call and waits:
  the same cards and rules as Claude (in Agent: files outside the project, files that run code later and commands; in
  Auto nothing, except a change to the gate's own files; Plan and Ask change nothing). Antigravity's own modes still apply too: in Agent mode it runs no commands (the
  answer says which it didn't run); in Auto it runs them. A mode change stops approvals for the running answer and
  applies from the next message. If a change runs without the gate being asked (an Antigravity version without hooks),
  Kural stops Gemini and says so; if the hooks file can't be read, Kural doesn't start Gemini. Needs agy 1.3.4 or
  newer (checked with that one): an older one isn't started, and Kural says to run "agy update". Devices do not work with Gemini.
- Chat (panel on the right; Ctrl+L shows or hides it; with code selected in the editor, Ctrl+L adds that code to your
  message instead, also while the chat is open): tabs; modes Agent (edits files, asks before commands), Auto (unrestricted: no asking,
  also for dangerous commands and files outside the project; the AI ends each answer with a "What I did" list; the
  first switch to Auto explains this once; Gemini too, through Kural's gate; but the AI still never publishes in the
  browser, Gemini's own browser still asks, and so does a look into your Desktop, Documents, Downloads, Music, Pictures
  or Movies), Plan
  (a plan, then "Save plan" to write it to plans/*.md in the project, or "Build it"), Ask (answers only). Claude, Gemini and Codex search the web and read pages in every mode
  (Plan and Ask too). Claude and Gemini ask first (a card: Allow / Allow all), except in Auto: a web address can carry
  your project's data away. Codex: live search without asking, its commands stay offline. A model on this computer can't.
  Enhance prompt (the wand beside Send): your rough request goes to a quicker model (Claude Sonnet 5.5; for a ChatGPT or
  Gemini chat their equivalent: Codex's workhorse model, Gemini's Flash) that looks through the open project, read only
  (never secrets like .env or keys, never runs anything, at most 20 looks, 150 s; a file that tries to give an AI orders
  is marked with a warning wherever the prompt points to it), and rewrites it into a clear prompt:
  goal, constraints, expected output, success criteria, "Relevant context" pointers to the right files (only files that
  exist) and open questions. It keeps your language and adds no requirements of its own. While it works the line above
  the box says what it does ("Sonnet 5.5: Reading src/api/client.ts"); Stop ends it. The result replaces your text (@
  mentions stay); Undo puts back what you had. Nothing is sent: check it, then press Send for the chat's model.
  Voice input (the mic beside the wand, or Ctrl+Alt+V / Cmd+Alt+V): click, talk, click again (Esc cancels; it stops by
  itself after 5 minutes). Whisper writes down what you said on this computer, offline (English only); the first click
  asks to download it, about 60 MB, once, and nothing you say leaves the computer. Then the quickest model you have
  (Haiku, or Gemini's lightest, or your own model; never ChatGPT) removes "um", "ahm", repeats and false starts and fixes
  the grammar, keeping your words and every code, file and command name; without an AI set up the plain transcript is
  used. The text goes into the box at the cursor, never sent by itself; Undo puts back exactly what Whisper heard. On a
  Mac, macOS asks for the microphone once, at the first recording.
  Listen (the speaker button under a finished answer, beside Fork from here): Kural talks you through the answer like a
  friend explaining it, in a voice made on this computer (Supertonic 3, offline), while the part it explains is
  highlighted and kept on screen. It's a short walkthrough of the main points (about a minute or two), not the text read
  out, told with some enthusiasm; code is explained, not read. It starts at once (a short opener, then sentence by sentence
  while the rest is made). The player sits just above the chat box: Pause/Play, Rewind 5 s, the speed (0.5x, 0.75x, 1x,
  1.25x, 1.5x, 2x: the voice itself speaks faster or slower, and the speed you pick becomes the default), ✕, and three
  lines of what's said (the sentence before, the one now, the next); no slider; the button again stops it. The first
  click asks to download the voice, about 430 MB, once. The words come from the chat's quickest model (Haiku, or
  Gemini's lightest; a chat on your own model uses that model, so it stays on the computer; not ChatGPT: with only
  ChatGPT set up, Listen is greyed out). The walkthrough's text is kept with the answer, so listening again is instant and
  asks no AI; the audio isn't saved. One answer at a time; the sound plays only where you clicked; showing another chat
  there stops it. English only. Linux x64, Apple Silicon Macs and Windows x64.
  "/" at the start of the message lists your skills and commands (Claude models with "Use my Claude Code setup" on: your
  plugins' skills such as Superpowers' superpowers:brainstorming, your own, and Claude Code's like /code-review); type
  to filter, Tab or Enter puts it in, then add what it's for and send.
  Files are attached only when you choose them: @ mentions a file; + adds files, images, PDFs, or links a Jira ticket
  (Claude only); paste a screenshot; select text in the chat (an answer or your own message) and click "Add to chat"
  beside it: it goes into your message as a quote, and the AI gets the whole selected text. Side chat: select text in an
  answer and press Ask (beside Add to chat) to ask a quick question about it right under the answer; a fast model answers
  (Haiku, or the lightest Gemini model, or your own model; not ChatGPT, which can't be limited to answering), without tools. It's separate from the conversation (the
  chat's AI never sees it, it doesn't wait for or stop the main answer) and saved with the answer; follow-ups in the same
  box remember it; Add to chat under a side answer brings that Q&A into your message. Model menu (bottom of the chat): Auto (Model Router), Claude's Opus/Sonnet/Haiku, Google Gemini and
  ChatGPT (Codex) models (only the AIs you've set up), or a model on this computer (once you have one that can chat).
  The gear beside each name opens its settings: Auto's opens the Model Router; Claude's, Gemini's, ChatGPT's and your
  own model's open Kural Settings at that AI's card (connectors, when to switch away near a limit); intensity Low to Max (for Gemini it picks the model's thinking
  level); moods (Explorer, Critic, Learn: teaches you
  step by step and checks what you know first; in Learn, ask "explain it on a webpage" (Agent or Auto mode) and the AI
  builds a lesson page, a short slide deck with diagrams and few words, shown in Kural's browser beside the chat (the
  Explorer and the terminal close for a big screen; arrows or the dots move; the AI teaches it slide by slide in the
  chat; select text or click a visual on the page, then "Add to chat"; the page reloads when the AI changes it; kept
  privately, deleted with the chat); and your own: "Add your own mood…" at the end of the moods opens Kural
  Settings → Moods: a name, a one-line hint and instructions for the AI, with tips and examples; edit or delete them
  there; built-in moods you don't use (Default too) can be removed there with their ×, and Restore brings one back; the
  menu keeps at least one, and a new chat starts with the first mood left; a changed mood or mode applies from the next
  message); Multiple agents are switched off for now (one agent per chat). The mode can be changed while an answer runs (Agent to Auto: waiting commands run at once). Sending while
  an answer runs (Enter, or the arrow beside Stop) doesn't stop it: the message is queued (shown above the box) and the
  AI takes it in at its next step (after the command or edit it's doing) into the same answer, shown there as "You added
  this while it worked"; if the answer ends first, it's answered right after as your next message (Gemini and Kural-managed teams always do
  that). Stop (the square button, or Esc) stops the answer and puts queued messages back into the box. Each change
  can be reviewed, kept or undone ("Files changed" lists only the project's files: not notes in the temp folder or
  Claude Code's own plans and memory). How the AI worked is ONE timeline per answer: its thoughts in readable text between
  the steps it took (Read, Searched, Edited +18 −3, Ran npm test · passed; click a step for all of it), headed "Working… 12
  s" and then "Worked for 34 s · 2 thoughts, 3 reads, 1 command", with a tag saying what the thinking is:
  "Claude's summary" or "ChatGPT's summary" (Anthropic and OpenAI only send a summary of their models' thinking, never the raw
  thinking: Kural shows it as it comes and summarizes nothing itself) or "raw" (models on this computer, open models
  through Codex); Gemini (Antigravity) passes no thinking on. While it works it grows as tall as the chat, then scrolls
  inside, following the newest line; scroll up in it to read and it stays there until Latest. When it's done it folds to
  its header ("Worked for 34 s · …"; click to open it again) and the answer comes up under it.
  Answers are drawn calmly ("Calm reading"): real headings, the point first in a box (an answer that starts with
  "**Done:** …", "**Goal:**", "**In short:**"), callouts whose color means something (GitHub's alerts: > [!NOTE] blue
  Note, > [!TIP] green Tip, > [!IMPORTANT] purple Important, > [!WARNING] amber Watch out, > [!CAUTION] red Risk), quotes,
  nested lists, checkboxes, numbered steps whose file is a chip that opens it, tables with number columns lined up on the
  right and status words colored (passed green, failed red, no grey).
  Questions: Pick, then Send. On a question card (the AI asking with options) and on options the AI wrote at the end of
  its answer (a question, then a numbered list, or "- [ ]" lines when several may be picked, or a yes/no question), a
  click picks an option and a second click un-picks it; the picks stay on the question, the line above the box shows
  "Your answer … (press Send)", and nothing is sent until you press Send (Enter); what you type in the box goes with
  it as a note. The card has no Submit (Skip stays; "Other…" takes your own words). Only the last answer of an idle chat
  is clickable. "Ask about this question" (a box under the options): the AI that asked answers right there, then asks
  again, changed if needed ("Updated after your question"; "The question before you asked" opens the old one).
  Notifications: when an answer is done or needs you (a command or file to allow, a question, a plan to build, an
  error, a login), a system notification names the chat ("Fix the login is done"); click it to go there. By default only
  while you're not looking (Kural's window not in front, or that chat not on screen); setting kural.notifications:
  whenAway, always, off. A team's answer notifies once, at the end; Stop doesn't. On a Mac the notification comes from
  the system's own notification command and shows as Script Editor; if none shows: System Settings > Notifications,
  allow Script Editor and Kural, and turn Focus / Do Not Disturb off. "Kural: Test Notification" sends one now and says
  how it was sent; Kural's log says why each notification was or wasn't sent. On Ubuntu: notify-send (libnotify-bin). While any chat works, the Mac
  doesn't go to sleep by itself (the screen may turn off; closing the lid still sleeps it; macOS only; setting
  kural.chat.keepAwake). Hover a message you sent: Edit (change it and send again: it replaces that message and everything after it; asks
  whether the code goes back too) and Restore code (the files the AI changed after that message go back as they were;
  the conversation stays; checkpoints are kept 30 days, also after a restart). Hover any message in an idle chat:
  "Fork from here" opens a new chat with the recorded conversation through that message, including attached context
  and tool results. It keeps the model, mode and other choices; the original chat's conversation stays as it is. When
  answers after that message changed files, it first asks whether the code goes back too (Restore Code: those files
  as they were at that message; Keep Code: files stay as they are now).
  Inherited file-change cards can be reviewed; keep/undo belongs to the original chat. Both chats appear in History.
  Next to the send button: how full the
  conversation's context window is (click: AI Usage; hover: tokens in context / context capacity, and total tokens consumed,
  read and written). Pictures in answers are shown;
  click one to see it full size in its own tab. Links to
  files in an answer (and file names in \`code\`) open the file (at the line), also when the answer gives only its name
  or a path from another folder: Kural finds it in the project (several with that name: you pick one); web links open
  in Kural's browser tab. The clock
  button: every chat from every workspace (search, pin, delete). Drag a chat tab out of the Kural panel and let go (in
  the editor area, say) to open it beside the code, in an editor group next to the one you're in (VS Code's own
  above/below drop zones don't show for it: move its editor tab afterwards for that); it then shows only that chat, and
  leaves the side panel's tabs until its editor closes (also "Kural: Open a Chat Beside the Code"). To bring it back:
  the button in that editor's title bar, "Move Chat Back to the Kural Panel" (or close its editor tab).
  Chats side by side in the panel itself (also when it's maximized: the Maximize button on its title bar, or the panel
  dragged wider): drag a tab onto the left or right side of the chat ("Split left/right" shows), or press the Split
  button beside + (a new chat; a narrow panel opens it beside the code instead). Up to four, each with its title and
  × (back among the tabs); drag a title to move that chat (to a side, onto another chat, onto the first column: back
  among the tabs, or out of the panel: beside the code); drag the line between two to resize. Made narrower, they stack
  above each other. They come back after a restart.
- Source Control panel: the sparkle button in the commit message box writes a short commit message (at most 200
  characters: a subject line, maybe a line or two more) from your staged changes (or all changes), in the style of your
  recent commits, with the chat's model; edit it and commit as usual.
- Kural's browser (Command Palette "Kural: Open Browser", or + in the chat: "Pick from a browser", or ANY web link in an
  answer, which opens there instead of the outside browser): real web pages inside Kural, your app on localhost or any
  site, with Design Mode like Cursor. The browser bar's inspect button ("Add Element to Chat", Cmd/Ctrl+Shift+C): click
  something on the page and it's added to your message with its HTML, size and computed CSS and a picture of it; "Comment
  on Elements" adds what you want changed ("make this bigger") as the start of your message; its dropdown also adds a
  screenshot, an area or the full page, and the console logs. Then Kural finds the code behind the element in the project
  and changes it; reload the page to see it. (If nothing is added when you click an element,
  use a screenshot of the area instead.) It keeps nothing: no cookies, logins, history of sites' data or cache are saved;
  each time Kural starts the browser is fresh (logins last until that window closes). Data older versions saved is
  deleted once.
- The AI uses Kural's browser (Claude and ChatGPT (Codex) models; setting kural.browser.aiControl, on by default): ask
  it to do something on a site ("open instagram.com and make a reel from videos/run.mp4 up to the caption", "fill in
  this form", "answer the quiz on this page"). It opens pages in a tab beside the code (log in there yourself first;
  the login lasts until the window closes, since Kural's browser keeps nothing; it never asks for passwords), reads them, clicks, types, chooses, uploads files, drags (a slider, a
  trim handle), scrolls and takes pictures of the page while you watch; its steps show in the answer ("Clicked Next").
  Kural's rule: the AI NEVER publishes, posts, shares or sends anything (Share, Post, Publish, Send, a comment, a
  message, an email), in any mode, not even when you ask: it goes as far as a draft ("Save draft" is fine), stops and
  says what's ready, and you press Share yourself. Kural checks every click, Enter key and page question first (in many
  languages); on Instagram the publish request itself is also stopped while the AI works in that tab (your own Share
  too, until its answer ends). Agent mode asks once per site in a chat ("Let the AI use instagram.com in Kural's
  browser?") and before Submit, Pay, Delete or Discard; Auto doesn't ask; Plan and Ask only read pages. A file from
  outside the project asks before it's uploaded (Auto doesn't). Instagram's website doesn't save drafts (Instagram keeps
  them in its phone app), so there the AI stops before Share and the reel waits in that tab for you; Meta Business
  Suite offers Save as draft / Finish later for some accounts. Gemini and a model on this computer can't use Kural's
  browser; Gemini's own browser (Antigravity's) asks before every action, in Auto too: Kural can't check it for publishing.
- Devices over SSH (a Raspberry Pi, a board computer…): + → Link device → add one (name, address, username, password).
  Kural uses the password once to put its own SSH key on the device and doesn't save it anywhere (no keychain); after
  that it logs in with the key. A chat linked to a device can run commands and read/write files on it (asking first in
  Agent mode; Claude and Codex models, not Gemini or a model on this computer). Click the device's chip
  for a terminal on it. Command Palette "Kural: Devices": terminal, link to the chat, set up again (after reinstalling
  the device: asks the password once more), forget its host key, remove (also takes Kural's key off the device).
- Your own models: Kural Settings → Your own model → "Find & download models…" (or "Kural: Find and Download
  Models"): Ollama's models that can use tools, sized for this computer. They work offline and show in the model menu
  once one can chat.
- Search & Ask (left side bar, magnifier icon), two tabs. Search (Ctrl+Shift+F, Replace Ctrl+Shift+H): find and
  replace in the project's files, everything VS Code's own Search did (Kural hides that one): Match Case, Whole Word,
  Regular Expression, Preserve Case, files to include/exclude (the ... under the box), open editors only, as you type,
  history (Up/Down), tree or list, Replace Preview (click a result while Replace is open), Replace All, dismiss,
  right-click Copy, F4 for the next result, Open in Search Editor; Explorer: right-click a folder, Find in Folder.
  Ask (Ctrl+Alt+A): describe what you're looking for in plain words; Kural lists the exact places. Ask always uses the
  fastest model you have (Claude's Haiku, or the lightest Gemini or Codex model; your own model if that's all), not the
  chat's model; each result list shows which. An empty box shows no results (in both tabs).
- Extensions & Plugins (the Extensions icon on the left, Ctrl+Shift+X), two tabs like Search & Ask: Extensions is VS
  Code's own (Open VSX: search, install, update, turn off); Plugins: the AI plugins (skills, commands, agents, hooks, MCP
  servers) of the chat's AI, from that AI's own plugin manager. It follows the chat's model (Claude's plugins for a
  Claude model, ChatGPT's for Codex, Gemini's for Gemini; a model on this computer has none); "Plugins for" shows another
  AI's without changing the chat. Search filters them. Claude: Installed, Available (Anthropic's plugin directory, a few
  thousand, and the marketplaces you add), Marketplaces (Add a Marketplace…: owner/repo such as
  obra/superpowers-marketplace, an https Git address, or a folder); Install, Turn Off / On, Remove. Claude's Install asks
  where, when a project is open: All My Projects, This Project (Shared: in the project's .claude/settings.json, which
  goes into Git, so teammates get it too) or This Project, Only Me (.claude/settings.local.json); such a plugin's row
  says "This project" / "This project, only me" and its Turn Off and Remove act there; click a plugin for
  its page: where it comes from, what it adds (each skill, command and agent with its description, the hooks and MCP
  servers with what they run; for one that isn't installed yet, read from its GitHub repository), its README, how many
  tokens it adds to every chat, Update. ChatGPT (Codex): plugins come from the marketplaces you add (none at first); Install and Remove (Codex
  can't turn one off). Gemini (Antigravity): no catalog: Add a plugin from a folder or a Git address (https; Antigravity
  checks it first), Turn Off / On, Remove. Installing always asks first and says where it comes from: a plugin runs code
  as you (its hooks and MCP servers start with that AI, and Kural's approval cards don't ask about them); one its
  marketplace installs with a command shows that command first. The chats pick a change up by themselves (Claude's at
  once, ChatGPT's and Gemini's at their next message). Claude's chats use plugins only with "Use my Claude Code setup"
  on (Kural Settings → Claude). Claude's and ChatGPT's plugins belong to the profile; Gemini's are the same in every
  profile. "Kural: Show Plugins" opens it. (If VS Code's Extensions side bar can't take the tab, Plugins has a side bar
  of its own: the plug icon.)
- Inline edit (Ctrl+K, Cmd+K on a Mac): select code, say what to change, review a read-only red/green diff, Accept or Reject. The original file changes only on Accept.
- With code selected in the editor, two buttons float in the editor's bottom-right corner: "Add to Chat (Ctrl+L)" (the
  selection goes into your chat message) and "Edit Selection (Ctrl+K)" (inline edit; not in read-only files).
- Model Router (Auto in the model menu, like Cursor's): Balance, Cost (saves your usage limits: lightest model that can
  do it, the most capable only for complex work) or Intelligence (a step more capable; quick questions still go to a
  cheaper model; "Build it" on an agreed plan goes to a light model such as Haiku in Balance and Cost, and a step that
  keeps failing moves up again). Per message it picks the model and the intensity, only among Claude, Google Gemini and ChatGPT (Codex)
  models (never a model on this computer: pick those yourself), switching between those AIs with the conversation handed
  over (everything visible: requests, what was sent, answers, steps and results, files changed, plan and to-do list,
  pictures; a long conversation gets an overview sized for the next model and a complete local history file it can
  read to recover omitted details). It reads how much work the request is (Kural's word classifier, or a helper model through Ollama: MiniLM,
  Granite or Qwen3, downloaded in the panel), what's attached (files, error output, a picked element), each AI's usage
  left (avoids one past half; from 80 % of a Session or Weekly limit it moves to another AI, Claude to ChatGPT (Codex)
  first, then Gemini, even in a long chat; skips one at 98 %), the conversation's length (long chats stay on their AI on
  close calls) and what you did after earlier answers (learned per workspace; "Kural: Forget What Model Router
  Learned"). When an answer stops because its AI reached its usage limit, Auto carries the same request on with another
  AI at once (the stopped answer gets a note) and avoids that AI until the limit resets. Switching a chat to another AI
  yourself (model menu), or switching an AI's account or logging in again, also hands the conversation over. Each answer
  shows the model; hover: why. The profile is picked only in the model menu. The Model Router icon in the status bar
  (two arrows in boxes; hover: "Model Router" and the step that reads requests) opens its panel: only a slider from
  Faster to Quality for what reads requests (four steps: Native, MiniLM, Granite, Qwen3; the panel names the step,
  Download when it isn't on this computer yet; the info button explains each, and says Auto picks from every cloud model
  of the AIs you set up).
- Tab Completion: grey suggestions as you type; Tab accepts. Click the icon in the status bar to enable or disable
  suggestions (sparkle while on, crossed out while off; Ctrl+Alt+Space also toggles). Its hover has a Tab Completion
  settings link, or Kural Settings → Tab Completion opens its panel: on/off, speed, engine (Auto, local or Claude) and model.
  A model on this computer is used only after "Set up" there (or your own model in Get started). Set up is one click:
  without Ollama it downloads and installs Ollama first (download %, install %; on Linux it asks for the password),
  then downloads the model. If the installation fails, Kural offers ollama.com's own
  installer.
  It learns from your work in each workspace only when you turn it on (setting kural.tabCompletion.learnFromActivity,
  off by default; "Kural: Forget What Tab Completion Learned" clears it).
  While a chat answers with a model on this computer (Ollama runs both on one GPU, so Tab's local answers slow to 2-3 s),
  Claude helps Tab if it's set up (also for "Local model"); without Claude, Tab asks a little less often meanwhile.
- Change a name in your code (type over it, or accept a Tab suggestion that changes it) and Kural looks for the old name
  in the rest of the project (whole word, same capitals; not node_modules, dist, build, minified/lock files or prose like
  READMEs) and offers: "count" became "total" here. Also change it in this file (2 places) and 3 other files (7 places)?
  Review opens Search & Ask filled in (Match Case + Whole Word, the new name in Replace); Change all changes every place
  in one edit (Ctrl+Z undoes it). Not for new names you're typing, keywords or one-letter names. Off: setting
  kural.tabCompletion.renameAcrossFiles.
- Memory: Kural's Claude helpers (Tab Completion's, terminal Tab, Ctrl+K, commit messages, Ask) start when they're first
  needed and stop after a few idle minutes (the next use starts them again in about a second); each open chat keeps one
  Claude Code process (~120 MB) while it's on screen or was used in the last 10 minutes (at most two idle ones stay
  warm; it starts again, same conversation, when you open the chat or send to it). Ollama keeps Tab Completion's model loaded 30 minutes after
  the last suggestion. A model on this computer takes gigabytes (a 9B model at kural.localModels.contextLength 32768:
  about 7.8 GB).
- Terminal: Kural suggests the whole command line; Tab fills it in, Enter runs it. Plain words work too: type what you
  want ("i want to delete the file install.sh", "push this to the fix/login branch", "commit with message fixed the
  login") and Kural suggests the command (rm install.sh), first in the list; Tab puts it in place of your words.
  The terminal's initial "Show suggestions" hint is hidden by default; suggestions still work.
- AI Usage (bottom panel, next to Terminal; Command Palette "Kural: Show AI Usage"): per AI, its Session and Weekly
  limits with when they reset, always shown; only the tokens are under "Tokens" (click to open). Session = the 5-hour
  limit (Claude and Codex); Gemini has weekly limits.
  The status bar shows only each AI's Session limit: the chat's AI with when it resets ("Claude Session 50% · resets
  42m"), the others short ("Codex 12%"); Gemini, which has only weekly limits, shows its name. Weekly numbers stay in
  the hover at every usage level; hover for every AI's Session and Weekly limits; orange
  from 80 %, red from 95 %; click it for the panel. Also tokens per AI: read (and how much from
  the cache) and written, today, 7 days and 30 days (every Kural feature: chat, Tab Completion, Ctrl+K…).
- Switching AI near a limit: on each AI's page in Kural Settings (Settings on its card, or the gear in the model menu):
  "Switch to another AI near a limit" (off by default) and that AI's points: Session [70] % and Weekly [70] % (1 to 99;
  Gemini: Weekly only). When the chat's AI reaches one, Kural transfers the same chat
  with its visible context to another available cloud service that's below its own points. It waits for commands, edits,
  approvals, background work and agents to finish. A paused request continues there; a completed answer switches for
  the next message. This works with a model you picked yourself and with Auto. Without a suitable service it stays put;
  usage reports can arrive after an answer, so the percentage is a switching trigger, not a hard quota cap.
- Files outside the project: the AI asks first ("Read this file?", "Change this file?"), except files you attached.
  Inside the project it doesn't ask, except for files that run code later (git hooks, .vscode/tasks.json, package.json,
  .env, Makefile, Dockerfile, workflows, shell profiles) and the temp folder (Agent mode still asks before commands).
  That's Agent mode: Auto asks about none of these. Kural never looks through Desktop,
  Documents, Downloads, Music or Photos by itself (on a Mac that would make macOS ask about Kural). On a Mac the AI's
  own look there (a command, a read, a search over your whole home folder) asks first, in every mode, Auto too, with
  no "Allow all": "It looks in your Downloads folder…"; not for a file you attached, nor a project you opened inside
  Documents or Desktop. ChatGPT (Codex) runs simple read-only commands without asking Kural, so for it only its
  instructions keep it out.
- Trust a workspace before using Kural AI; Kural is unavailable in Restricted Mode. Ask and Plan reject mutating
  requests handled by Kural's permission policy. Provider-native reads are not confined by this policy. Gemini's
  approval gate (Antigravity hooks) relies on Antigravity running its hooks; use a separately isolated account for
  untrusted content.
- The status bar's person icon shows the name on the account the chat's AI uses ("Peasant Adithya"); hover for all.
- Kural Settings (an editor tab: status bar person icon, the Kural panel's ... menu, or "Kural Settings"): a short
  overview. A card each for Claude, Google Gemini, ChatGPT (Codex) and your own model: who you're logged in as, plan,
  usage bars, and Settings (that AI's own page; the model menu's gear opens the same page), log in / log out / switch
  account / set up. An AI's page: Connectors (Claude and ChatGPT: each with its status, Sign in when one needs it (Codex
  opens its login; Claude opens a terminal where you type /mcp), remove; "Add connector" opens a searchable list: Popular
  ones (Notion, Linear, Sentry, Atlassian, Asana, Stripe, Vercel, Supabase, Hugging Face, Context7, Cloudflare docs,
  Playwright, GitHub, Filesystem) and the official MCP directory as you type (those show the exact command
  or address and ask you to confirm: nobody checked them); Add, and fill in a token or folder only if
  it asks (on Mac and Linux a token is kept in a private file in Kural's storage, never on a command line; Windows passes
  it to the program directly); "Add one by hand" at the bottom takes a command or web address; ChatGPT can't use ones that need a key header
  or the older SSE kind; Claude also: "Use my Claude Code setup (plugins, skills)" and Reload; Gemini: no connectors
  yet), then "Switch to another AI near a limit". Your own model's page: Find & download models, change model, context
  length. Then Moods (your own chat moods: add, edit, delete; remove or restore the built-in ones); What Kural learns
  (Tab Completion learning from your work, off by default; Auto learning which models you prefer, on by default; each
  with "Delete what it learned"); then Kural's version and Check for updates, Get started, Tab Completion, Profiles,
  all settings, the log, crash reports, the guide, Export settings / Import settings (a file with Kural's settings,
  editor settings, shortcuts, extensions, chat defaults, devices; settings that look like passwords or keys are left
  out, but check the file before sharing it; you pick what to import. Import never takes settings that pick a program,
  start a terminal, set a proxy or turn on Auto, nor shortcuts that type into the terminal; extensions install only
  after you agree to the list).
  "Allow all" on a card covers only that card's kind for the rest of the chat: commands, web searches and pages, Kural's
  browser (every site, and Submit and the like; never publishing), or one connector's tools (never a file outside the
  project, never Gemini's own browser: those are yes or no each time). It counts only for that mode,
  model and conversation: changing the mode or model (also when Auto picks another one) or a handoff ends it, and Kural
  asks again. In Ask and Plan, a connector's tools that change things (creating a pull request, a Notion page, a Jira
  issue) are refused, also after "Allow all"; its lookups ask first. ChatGPT (Codex) runs Ask and Plan without your
  connectors, outside Auto without its apps, and never with its own browser and computer use, in Auto too (Kural can't
  see what those click, so it couldn't keep the AI from publishing; it uses Kural's browser instead).
  "Build it" switches to Agent (Auto only if the chat is already in Auto). Kural's browser opens only http/https
  addresses; without the editor's Integrated Browser a page opens in your web browser.
  Kural's log: "Kural: Show Log" (Command Palette) or Kural Settings → the log (an editor tab; Kural hides VS Code's
  Output tab; the Kural panel's title bar has no log button).
- Crash reports: when Kural closed unexpectedly, the next start saves a report (macOS's crash reports, VS Code's logs, which
  windows ended) on this computer and offers Show report / Report a bug (copies it; you paste it into the bug form).
  "Kural: Show Crash Reports" lists them.
- Updates: Kural checks once a day; also Help > Check for Updates, the Kural panel's ... menu, or Kural Settings. A
  final version is offered final versions only, a test version (alpha, beta, rc) also newer test versions; the setting
  kural.updates.testVersions offers test versions to anyone. It
  installs after Kural has fully closed (an unsaved file keeps it open: Kural says so), checks the new copy is whole
  (on a Mac: the Electron Framework and helper apps) before it touches the old one, puts the old version back if the
  install fails, and says at the next start if it didn't finish. It installs only a release whose checksum list is signed
  by Kural's release key and matches the download; "Kural: Verify this installation..." checks the running version's list.
  After an update (also one installed by hand), the first start opens "What's New in Kural": the release notes of every
  version since the one you had. "Kural: What's New" opens it any time.
- Uninstalling: first Command Palette "Kural: Remove Kural's Data..." (takes Kural's key off your devices and its gate
  out of Gemini's settings, removes connectors whose key Kural keeps, logs out other profiles, then closes Kural and
  deletes everything it keeps: chats, History, checkpoints, settings, extensions, caches). Then remove the program (Mac:
  drag to the Trash; Ubuntu: sudo apt remove kural; Windows: Settings > Apps, with an optional "Your Kural data" box).
  Claude Code, Codex, Antigravity and Ollama stay (programs of their own). Guide: the wiki's Uninstall page.
- Installing on Windows: Windows says "Windows protected your PC" with only "Don't run", because the installer isn't
  code-signed yet: click the small "More info" link, then "Run anyway" ("Unknown publisher"). Kural's own updates don't
  ask again. No "Run anyway" at all: Smart App Control or a company policy blocks unsigned programs.
- Themes: Kural Dark and Kural Light (Preferences: Color Theme): like VS Code's own, code in many colors, purple for
  buttons and focus. Kural Light has stronger contrast than VS Code's light theme: the side bar and panels are a shade
  darker than the editor, with clearer borders, a light purple selected row and darker secondary text.
- Profiles: a profile is a separate Kural setup with its own Claude and ChatGPT (Codex) accounts, e.g. a personal one and
  a work one. The status bar item (person or briefcase icon and the profile's name) shows the current one; click it to
  switch, or for "New profile…" (Personal or Work, a name, share chats or keep them separate) and "Manage profiles…"
  (rename, share / stop sharing, delete). Switching reloads the window so everything starts again with the other
  accounts; a new profile opens Get started to log in. Logins and usage numbers are always separate; sharing means the
  same chats, History, open tabs and Tab Completion memory as the main profile. Google Gemini and models on this
  computer are the same in every profile. On a Mac, a new profile needs Claude Code 2.1.296 or newer (with an older one, New
  profile offers "Update Claude Code": one click, then it goes on; if that fails, "Update in a Terminal").
  CLAUDE_CODE_OAUTH_TOKEN or an API key in your environment applies to every
  profile.
- Workspace Color: right-click the activity bar (the icons on the far left) → "Workspace Color...", or "Kural: Workspace
  Color...": pick a color (soft shades: deep muted ones with a dark theme, pastels with a light one; or Custom hex) and the activity bar takes it, so you can tell your workspaces apart. Each
  workspace keeps its color in its own settings (.vscode/settings.json, or the .code-workspace file); "Remove color"
  takes off only Kural's colors. Needs a folder open.
- VS Code's Run and Debug side bar, Debug Console and Ports panels are hidden to keep Kural simple; the setting
  kural.showDebugViews brings them back at once. While you debug (F5), Run and Debug and the Debug Console show anyway.
- Full guide: ${WIKI}
If they ask for something Kural doesn't have, say so plainly (don't pretend), suggest the closest thing it has, and
invite them to ask for it as a feature, with this link: [Ask for this feature](${ISSUES}).`;

// The short version, for a model on this computer: every token of the instructions costs it time before its first word
// (Ross measured the whole guide in a 9,600-token first message: 28 s on an M5 before qwen3.5:9b said anything). The
// essentials and where the full guide is.
const GUIDE_LOCAL = `

About Kural (when the user asks about Kural itself): a code editor (VSCodium, so VS Code's features and extensions
work) with an AI assistant: Claude, Google Gemini, ChatGPT (Codex) or a model on the user's computer (Ollama, offline:
that's you). Main features: Get started (set up an AI); the chat (Ctrl+L shows or hides it: modes Agent, Auto, Plan,
Ask; @ mentions a file; / lists your skills (Claude); the wand beside Send enhances your prompt; the mic beside it (Ctrl+Alt+V) turns what you say into text; + attaches files; select text in the chat, then "Add to chat" quotes it; the model menu has models, intensity and moods; hover a message to Edit it, Restore code, or
Fork from here; the clock button has every chat); Ctrl+K proposes changes to selected code in a read-only diff; Tab Completion; plain words in
the terminal ("push this to main", then Tab); Search & Ask; Extensions & Plugins (the chat's AI's plugins beside VS
Code's extensions); Kural's browser; devices over SSH; the Model Router (Auto);
Kural Settings (accounts, usage switching, moods, updates). Jira
tickets and Claude Code's connectors need Claude. For anything else, point to the full guide: ${WIKI}. If Kural can't do something, say so plainly and
link [Ask for this feature](${ISSUES}).`;

module.exports = { GUIDE, GUIDE_LOCAL, ISSUES, WIKI };

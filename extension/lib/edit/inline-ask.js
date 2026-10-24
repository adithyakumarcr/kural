// Ctrl+K's question, right under the code it's about (Adithya, 22 Oct 2026: not in the bar at the top of the window).
// The box is VS Code's comment widget: a thread of Kural's own comment controller, placed under the selection's last
// line, with an input and its buttons, like Cursor's (Adithya, 24 Oct 2026): Edit (Enter), Quick Question (Alt+Enter:
// answered right in the box, lib/edit/quick-question.js), Send to Chat (Ctrl/Cmd+L: the code and your words go into the
// chat's message box) and Cancel (Esc). Shift+Enter is a new line (package.json keybindings, `commentThread ==
// kural-edit`; VS Code puts each button's key in its label). Only quick questions and their answers show as comments in
// it; the thread goes as soon as you edit, send to the chat or cancel. Where the comment widget can't be used (an editor
// without it), the old input bar at the top asks (edit only).
const vscode = require("vscode");
const { log } = require("../log");

const CONTEXT = "kural-edit";
// The input of a comment box (Kural's question, or any other): an editor of its own, not a file you're in.
const isCommentInput = (ed) => !!ed && ed.document.uri.scheme === "comment";
const MODES = new Set(["edit", "ask", "chat"]);

class InlineAsk {
  constructor(context) {
    this.pending = null;   // { thread, resolve, uri, question, toChat, talk, asking }
    this.nextMode = null;  // (a key asked for Quick Question / Send to Chat: VS Code's submit runs the first button)
    this.ctl = null;
    try {
      this.ctl = vscode.comments.createCommentController("kural.inlineEdit", "Kural");
      context.subscriptions.push(this.ctl);
    } catch (e) { log(`inline edit: no comment widget here (${e.message}); the input bar asks instead`); }
    // A button passes { thread, text }; a key passes nothing, so it goes through VS Code's own submit, which hands the
    // first button (Edit) the text: that one then does what the key asked for.
    const via = (mode) => (reply) => (reply && reply.thread ? this.answer(reply, true, mode) : this.byKey(mode));
    context.subscriptions.push(
      vscode.commands.registerCommand("kural.inlineEdit.submit", (reply) => {
        const mode = this.nextMode || "edit";
        this.nextMode = null;
        clearTimeout(this.modeTimer);
        return this.answer(reply, true, mode);
      }),
      vscode.commands.registerCommand("kural.inlineEdit.question", via("ask")),
      vscode.commands.registerCommand("kural.inlineEdit.toChat", via("chat")),
      vscode.commands.registerCommand("kural.inlineEdit.cancel", (reply) => this.answer(reply, false)),
      // (Another file in front: the question there goes. Not the box's own input: VS Code reports it as the active
      // editor when it takes the keyboard (a "comment:" document), which closed the box the moment it opened.)
      vscode.window.onDidChangeActiveTextEditor((ed) => {
        if (!this.pending || isCommentInput(ed)) return;
        if (!ed || ed.document.uri.toString() !== this.pending.uri) this.finish(undefined, { refocus: false });
      }),
      { dispose: () => this.finish(undefined, { refocus: false }) });
  }

  // The instruction you typed, or undefined (cancelled, or sent to the chat). line: the selection's last line (the box
  // opens under it). question(text, earlier, token) → the answer or null; toChat(text); talk: the array the box's
  // questions and answers are kept in ([{ q, a }]), so the edit can be told about them.
  async ask(editor, line, { generating, question = null, toChat = null, talk = [] } = {}) {
    // (The placeholder names the keys: VS Code's buttons here don't show them.)
    const mac = process.platform === "darwin";
    const keys = `${mac ? "⌥↵" : "Alt+Enter"} quick question · ${mac ? "⌘L" : "Ctrl+L"} send to chat`;
    const words = generating
      ? { label: "Kural: write code here", placeHolder: `Write code here · ${keys}`, prompt: "Write code here…" }
      : { label: "Kural: edit the selection", placeHolder: `Edit selected code · ${keys}`, prompt: "Edit the selection…" };
    if (!this.ctl) return this.bar(generating);
    this.finish(undefined, { refocus: false });   // (a question still open from before)
    let thread;
    try {
      this.ctl.options = { placeHolder: words.placeHolder, prompt: words.prompt };
      thread = this.ctl.createCommentThread(editor.document.uri, new vscode.Range(line, 0, line, 0), []);
      thread.label = words.label;
      thread.contextValue = CONTEXT;
      thread.canReply = true;
      thread.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded;
    } catch (e) {
      log(`inline edit: couldn't open the box at the selection (${e.message}); the input bar asks`);
      if (thread) thread.dispose();
      return this.bar(generating);
    }
    const answer = new Promise((resolve) => {
      this.pending = { thread, resolve, uri: editor.document.uri.toString(), question, toChat, talk, asking: null };
    });
    await this.focus(thread);
    return answer;
  }

  // Its input gets the keyboard (VS Code's own "+ comment" box does that by itself; one made here needs asking). Also
  // after a quick question: VS Code folds the input away once a button ran.
  async focus(thread) {
    try { await thread.reveal(undefined, { focus: vscode.CommentThreadFocus ? vscode.CommentThreadFocus.Reply : 1 }); }
    catch (e) { log(`inline edit: the box couldn't take the focus (${e.message}): click into it`); }
  }

  // (VS Code's submit returns before the button's command reaches Kural, so the mode waits for that command, not for
  // the submit: clearing it when the submit returned made Alt+Enter edit. Gone after 2 s: no button ran.)
  byKey(mode) {
    if (!this.pending) return undefined;
    this.nextMode = mode;
    clearTimeout(this.modeTimer);
    this.modeTimer = setTimeout(() => { this.nextMode = null; }, 2000);
    return vscode.commands.executeCommand("editor.action.submitComment");
  }

  // The box's buttons (and Enter / Alt+Enter / Ctrl+L / Esc): reply = { thread, text } from VS Code, or nothing (Esc).
  answer(reply, ok, mode = "edit") {
    const P = this.pending, stray = reply && reply.thread && (!P || reply.thread !== P.thread);
    if (stray) { try { reply.thread.dispose(); } catch { /* gone */ } return; }   // (a box left from before: closed)
    if (!P) return;
    if (!MODES.has(mode)) mode = "edit";
    const text = ok && reply && typeof reply.text === "string" ? reply.text.trim() : "";
    if (ok && mode === "ask" && P.question) {
      if (text) this.askQuestion(P, text);   // (not awaited: VS Code folds the input away once this returns)
      else setTimeout(() => this.focus(P.thread), 50);   // (nothing typed: the box waits)
      return;
    }
    if (ok && mode === "chat" && P.toChat) {
      this.finish(undefined, { refocus: false });   // (the chat's message box takes the keyboard)
      try { P.toChat(text); } catch (e) { log(`inline edit: couldn't send to the chat (${e.message})`); }
      return;
    }
    this.finish(ok && text ? text : undefined);
  }

  // A quick question: shown in the box at once ("Thinking…"), answered there; the box stays for the next one.
  async askQuestion(P, text) {
    if (P.asking) P.asking.cancel();   // (a new question replaces one still being answered)
    const cts = new vscode.CancellationTokenSource();
    P.asking = cts;
    const earlier = P.talk.filter((t) => t.a);
    const item = { q: text, a: null };
    P.talk.push(item);
    this.draw(P);
    setTimeout(() => { if (this.pending === P) this.focus(P.thread); }, 50);
    let a = null, why = "";
    try { a = await P.question(text, earlier, cts.token); }
    catch (e) { why = e && e.message ? e.message : String(e); }
    if (this.pending !== P || cts.token.isCancellationRequested) return;
    P.asking = null;
    if (typeof a === "string" && a.trim()) item.a = a.trim();
    else item.error = why || "No answer came back. Try again (Kural: Show Log has the details).";
    this.draw(P);
  }

  // The box's questions and answers as comments.
  draw(P) {
    const md = (s, icons = false) => { const m = new vscode.MarkdownString(s, icons); m.isTrusted = false; m.supportHtml = false; return m; };
    const plain = (s) => { const m = new vscode.MarkdownString(); m.appendText(s); return m; };
    const preview = vscode.CommentMode ? vscode.CommentMode.Preview : 1;
    const comments = [];
    for (const t of P.talk) {
      comments.push({ body: plain(t.q), mode: preview, author: { name: "You" } });
      if (t.a) comments.push({ body: md(t.a), mode: preview, author: { name: "Kural" } });
      else if (t.error) comments.push({ body: md(`$(warning) ${t.error}`, true), mode: preview, author: { name: "Kural" } });
      else comments.push({ body: md("$(loading~spin) Thinking…", true), mode: preview, author: { name: "Kural" } });
    }
    try { P.thread.comments = comments; } catch (e) { log(`inline edit: couldn't show the answer (${e.message})`); }
  }

  // refocus: the keyboard back to the code. A closed comment box leaves it nowhere (on the page itself), and the next
  // Ctrl/Cmd+K there was VS Code's two-key prefix: a second one said "(⌘K, ⌘K) is not a command" and nothing opened.
  finish(value, { refocus = true } = {}) {
    const P = this.pending;
    if (!P) return;
    this.pending = null;
    if (P.asking) P.asking.cancel();
    try { P.thread.dispose(); } catch { /* gone */ }
    if (refocus) {
      Promise.resolve().then(() => vscode.commands.executeCommand("workbench.action.focusActiveEditorGroup"))
        .catch((e) => log(`inline edit: couldn't give the keyboard back to the code (${e.message})`));
    }
    P.resolve(value);
  }

  // The input bar at the top of the window (the old way).
  bar(generating) {
    return vscode.window.showInputBox({
      title: generating ? "Kural: generate code here" : "Kural: edit selection",
      prompt: generating ? "What should Kural write here?" : "How should Kural change the selected code?",
      placeHolder: generating ? "e.g. a function that converts mm/s to m/min" : "e.g. add input validation and a docstring",
      ignoreFocusOut: true,
    });
  }
}

module.exports = { InlineAsk, CONTEXT, isCommentInput };

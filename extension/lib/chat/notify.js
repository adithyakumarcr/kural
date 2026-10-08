// System notifications for the chat (Adithya: "once the request is complete, or if it needs attention, a notification;
// on every platform"). One when an answer is done (a team's: when the whole team is), and one when it needs you: a
// command or file to allow, a device command, a question, a plan to build, an error, a login. Only while you're not
// looking (setting kural.notifications "whenAway", the default: Kural's window isn't in front, or that chat isn't on
// screen); "always"; "off". Each chat has one notification at a time (a new one replaces it), and it's taken away when
// you answer in Kural or open that chat. Clicking it brings Kural to the front and shows the chat.
//
// How: VS Code shows a real system notification as Kural on every OS (its hostService.showToast, an Electron
// Notification). Extensions can't reach it, so rebrand.py registers a command for it (Ross: _kural.osToast
// { title, body, id, attention } → { clicked, supported }, and _kural.osToastClear { id }). On a build without that
// command, or a system without notifications (Linux with no notification service): the OS's own way (macOS osascript,
// shown as Script Editor; Windows a PowerShell toast; Linux notify-send), else Kural's notification inside the window.
// No vscode here: the editor's parts come in (see Notifier).

const SETTINGS = ["whenAway", "always", "off"];

// Should this go out? setting: kural.notifications; focused: Kural's window is in front; onScreen: the chat is visible.
function shouldNotify(setting, { focused, onScreen }) {
  const s = SETTINGS.includes(setting) ? setting : "whenAway";
  if (s === "off") return false;
  return s === "always" || !focused || !onScreen;
}

// Markdown to one short plain line (an answer's first sentence for the notification).
function plainLine(md, max = 140) {
  let s = String(md || "")
    .replace(/```[\s\S]*?(```|$)/g, " ")                 // code blocks
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")               // pictures
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")             // links: their text
    .replace(/[`*_>#|~]+/g, " ")
    .replace(/^\s*[-+]\s+/gm, " ")
    .replace(/\s+/g, " ").trim();
  const sentence = /^(.{20,}?[.!?:])\s/.exec(s);
  if (sentence && sentence[1].length <= max) s = sentence[1];
  return s.length > max ? s.slice(0, max - 1).trimEnd() + "…" : s;
}

// The words: { title, body }. kind: done | plan | permission | question | error | login.
// info: { chat (the chat's title), text (the answer), tool, detail (a command, a file), where (a device), question, error, who }
function message(kind, info = {}) {
  const chat = plainLine(info.chat || "Your chat", 60);
  switch (kind) {
    case "plan": return { title: `${chat}: the plan is ready`, body: "Build it, or tell Kural what to change." };
    case "permission": {
      const what = info.tool === "Bash" || info.tool === "DeviceCommand" ? (info.where ? `Run this on ${info.where}?` : "Run this command?")
        : /^(Write|Edit|NotebookEdit|DeviceWrite)$/.test(info.tool || "") ? "Change this file?"
        : /^(Read|Grep|Glob)$/.test(info.tool || "") ? "Read this file?" : "Allow this?";
      const detail = plainLine(String(info.detail || "").split("\n")[0], 110);
      return { title: `${chat} needs your OK`, body: detail ? `${what} ${detail}` : what };
    }
    case "question": return { title: `${chat} has a question`, body: plainLine(info.question || "Kural is asking you something.", 140) };
    case "error": return { title: `${chat} stopped with an error`, body: plainLine(info.error || "Something went wrong.", 140) };
    case "login": return { title: `${chat}: ${info.who || "the AI"} isn't logged in`, body: "Log in to go on." };
    default: return { title: `${chat} is done`, body: plainLine(info.text, 140) || "The answer is ready." };
  }
}

// AppleScript text in double quotes.
const appleString = (s) => `"${String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/[\r\n]+/g, " ")}"`;

// The OS's own notification when Kural's (the _kural.osToast command) isn't there: [command, args, env] or null.
// (Title and text as arguments or environment variables, never pasted into a script: they come from the AI's answer.)
function fallbackCommand(platform, title, body) {
  if (platform === "darwin") return ["/usr/bin/osascript", ["-e", `display notification ${appleString(body)} with title ${appleString(title)}`], {}];
  if (platform === "win32") {
    const ps = "$ErrorActionPreference='Stop';" +
      "[Windows.UI.Notifications.ToastNotificationManager,Windows.UI.Notifications,ContentType=WindowsRuntime]|Out-Null;" +
      "$x=[Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02);" +
      "$t=$x.GetElementsByTagName('text');$t.Item(0).AppendChild($x.CreateTextNode($env:KURAL_TOAST_TITLE))|Out-Null;" +
      "$t.Item(1).AppendChild($x.CreateTextNode($env:KURAL_TOAST_BODY))|Out-Null;" +
      // (PowerShell's own app id: Windows shows toasts only for apps it knows.)
      "[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe').Show([Windows.UI.Notifications.ToastNotification]::new($x))";
    return ["powershell.exe", ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", ps], { KURAL_TOAST_TITLE: title, KURAL_TOAST_BODY: body }];
  }
  if (platform === "linux") return ["notify-send", ["-a", "Kural", "--", title, body], {}];
  return null;
}

// editor: {
//   hasToast()      → Promise<boolean>: is VS Code's _kural.osToast there (this build has Kural's patch)
//   toast(o)        → Promise<{ clicked, supported }> (_kural.osToast; settles when you click or close it, or it's replaced)
//   clearToast(id)  → withdraws one (_kural.osToastClear)
//   run(cmd, args, env) → Promise<boolean>   (the OS's own notification: true when it went out)
//   inApp(title, body) → Promise<boolean>     (Kural's notification inside the window: true = "Show" clicked)
//   log(text), platform }
class Notifier {
  constructor(editor) { this.e = editor; this.native = null; /* null: not known yet */ }

  async ready() {
    if (this.native === null) { try { this.native = !!(await this.e.hasToast()); } catch { this.native = false; } }
    return this.native;
  }

  // Shows it; onClick() when you click it. Never throws, never waits for you (a toast stays until you act on it).
  show({ id, title, body, attention = true }, onClick) {
    const clicked = () => { if (onClick) { try { onClick(); } catch (e) { this.e.log(`notify: ${e.message}`); } } };
    return this.ready().then((native) => {
      if (!native) return this.fallback(title, body, onClick);
      // (Not awaited: it settles only when you click or close it.)
      Promise.resolve().then(() => this.e.toast({ id, title, body, attention })).then((r) => {
        if (r && r.supported === false) return this.fallback(title, body, onClick);   // no notifications on this system
        if (r && r.clicked) clicked();
      }, (err) => { this.e.log(`notify: ${err && err.message}; the OS's own way instead`); return this.fallback(title, body, onClick); });
    }).catch((e) => this.e.log(`notify: ${e.message}`));
  }

  async fallback(title, body, onClick) {
    const cmd = fallbackCommand(this.e.platform, `Kural: ${title}`, body);
    let sent = false;
    if (cmd) { try { sent = await this.e.run(cmd[0], cmd[1], cmd[2]); } catch { sent = false; } }
    if (sent) return;
    try { if (await this.e.inApp(`Kural: ${title}`, body) && onClick) onClick(); } catch { /* nothing more to try */ }
  }

  // Takes a chat's notification away (you answered in Kural, or opened that chat).
  clear(id) { if (this.native) Promise.resolve().then(() => this.e.clearToast(id)).catch(() => {}); }
}

module.exports = { SETTINGS, shouldNotify, plainLine, message, fallbackCommand, Notifier };

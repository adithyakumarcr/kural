#!/usr/bin/env python3
"""Turns an unpacked VSCodium into Kural. Shared by the Linux, macOS and Windows builds.

Usage: rebrand.py <app-dir> <linux|mac|win>
  <app-dir> is VSCodium's resources/app folder (the one containing product.json).
"""
import base64, hashlib, json, os, re, shutil, sys, uuid

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NAME, TITLE, LONG = "kural", "Kural", "Kural Code Editor"
REPO = "https://github.com/adithyakumarcr/kural"


def load(p):
    with open(p, encoding="utf-8") as f:
        return json.load(f)


def save(p, d):
    with open(p, "w", encoding="utf-8") as f:
        json.dump(d, f, indent="\t")


def main(app, platform):
    # 1. Names, data folders, url scheme — so Kural never shares settings with VS Code/VSCodium.
    p = os.path.join(app, "product.json")
    d = load(p)
    d.update(nameShort=TITLE, nameLong=LONG, applicationName=NAME,
             dataFolderName=f".{NAME}", sharedDataFolderName=f".{NAME}-shared", linuxIconName=NAME, urlProtocol=NAME,
             serverApplicationName=f"{NAME}-server", serverDataFolderName=f".{NAME}-server",
             tunnelApplicationName=f"{NAME}-tunnel", darwinBundleIdentifier=f"com.{NAME}",
             win32DirName=TITLE, win32NameVersion=LONG, win32RegValueName=TITLE,
             win32AppUserModelId=f"{TITLE}.{TITLE}", win32ShellNameShort="&Kural", win32MutexName=NAME,
             win32x64UserAppId="{{" + str(uuid.uuid5(uuid.NAMESPACE_DNS, "kural.user")).upper() + "}",
             win32x64AppId="{{" + str(uuid.uuid5(uuid.NAMESPACE_DNS, "kural.system")).upper() + "}")
    # VSCodium's auto-updater would replace Kural with plain VSCodium. Turn it off.
    for k in ("updateUrl", "downloadUrl", "releaseNotesUrl"):
        d.pop(k, None)
    # Help → Report Issue and View License opened VSCodium's GitHub: Kural's bugs go to Kural's repository.
    d["reportIssueUrl"] = f"{REPO}/issues/new"
    d["licenseUrl"] = f"{REPO}/blob/main/LICENSE"
    # The login pages Kural opens for you (Get started: Gemini, Codex) open without VS Code's "open the external
    # website?" question first: you just clicked Log in.
    trusted = d.get("linkProtectionTrustedDomains", [])
    for site in ("https://accounts.google.com", "https://auth.openai.com"):
        if site not in trusted:
            trusted.append(site)
    d["linkProtectionTrustedDomains"] = trusted
    # VS Code looks for a GitHub login at every start (its "default account", for Copilot). That wakes the GitHub
    # login extension, which reads its saved login from the keychain: on a Mac, "Kural wants to use … Kural Safe
    # Storage", again after every update. Kural has no Copilot, so point that lookup at a provider that doesn't exist.
    agent = d.get("defaultChatAgent") or {}
    for kind in ("default", "enterprise"):
        if isinstance(agent.get("provider", {}).get(kind), dict):
            agent["provider"][kind]["id"] = "kural-no-default-account"
    save(p, d)

    # 2. The window/dock name on Linux ("codium" otherwise).
    pkg = os.path.join(app, "package.json")
    d = load(pkg)
    d["desktopName"] = f"{NAME}.desktop"
    # Electron names the macOS keychain item that protects the app's saved secrets after this ("<name> Safe Storage").
    # VSCodium's name made Kural ask for "VSCodium Safe Storage": VSCodium's item, not Kural's.
    d["name"] = TITLE
    save(pkg, d)

    # 3. Built-in extension: Kural. (Claudemeter, included in earlier versions, is gone: Kural's Account item replaces
    #    it. Remove it from an older unpacked app too.)
    ext = os.path.join(app, "extensions")
    shutil.rmtree(os.path.join(ext, "claudemeter"), ignore_errors=True)
    target = os.path.join(ext, NAME)
    shutil.rmtree(target, ignore_errors=True)
    shutil.copytree(os.path.join(ROOT, "extension"), target)
    # Kural's license (MIT + Commons Clause) travels with every copy of the app, as the license requires.
    shutil.copy(os.path.join(ROOT, "LICENSE"), os.path.join(ext, NAME, "LICENSE"))

    # 4. Ctrl+K / Cmd+K opens Kural's inline edit. Git's own Ctrl+K shortcuts would win,
    #    so move them to Ctrl+Alt+K (Cmd+Alt+K on a Mac).
    gp = os.path.join(ext, "git", "package.json")
    d = load(gp)
    for k in d["contributes"]["keybindings"]:
        for field, old, new in (("key", "ctrl+k ", "ctrl+alt+k "), ("linux", "ctrl+k ", "ctrl+alt+k "),
                                ("win", "ctrl+k ", "ctrl+alt+k "), ("mac", "cmd+k ", "cmd+alt+k ")):
            if k.get(field, "").startswith(old):
                k[field] = new + k[field][len(old):]
    save(gp, d)

    # 5. Kural's logo instead of VSCodium's: title bar, the faint logo in an empty editor,
    #    About; plus the window icon (Linux) and Start-menu tiles (Windows).
    media = os.path.join(app, "out", "media")
    for f in os.listdir(os.path.join(ROOT, "assets", "media")):
        shutil.copy(os.path.join(ROOT, "assets", "media", f), os.path.join(media, f))
    icon = os.path.join(ROOT, "assets", "icon.png")
    if platform == "linux":
        shutil.copy(icon, os.path.join(app, "resources", "linux", "code.png"))
    if platform == "win":
        try:
            from PIL import Image
            for size in (70, 150):
                tile = os.path.join(app, "resources", "win32", f"code_{size}x{size}.png")
                if os.path.exists(tile):
                    Image.open(icon).resize((size, size), Image.LANCZOS).save(tile)
        except ImportError:
            pass
    # 6. VS Code's own code: Help → Check for Updates… (Kural's updater), VS Code's Search and Output views hidden
    #    (Kural's Search & Ask side bar does text search; Kural's log opens with "Kural: Show Log"), and VSCodium's own
    #    content off the Welcome page.
    patch_workbench(app)
    # 7. The editor's own texts (menus, settings, messages) say "VSCodium": they say Kural.
    rebrand_messages(app)
    print(f"rebranded {app} for {platform}")


# Kural changes three things in VS Code's own code (workbench.desktop.main.js):
#   - VSCodium's own content off the Welcome page (see drop_vscodium_welcome).
#   - Help → Check for Updates…: extensions can't add items to the Help menu, so the item goes next to VS Code's
#     "Ask @vscode" Help item.
#   - VS Code's Search view and Output view never show: Kural's Search & Ask side bar has text search (find and
#     replace) and Ask together, and Kural's log is "Kural: Show Log". Each view gets VS Code's own "never" condition
#     (`when: <ContextKeyExpr>.regex("neverMatch",/doesNotMatch/)`, which the Search view already uses for a
#     keybinding); its container is "hideIfEmpty", so the activity bar icon and the panel tab go away too.
# VS Code checks that file against a fingerprint in product.json ("checksums") and calls the install "corrupt" if it
# changed, so the fingerprint is updated too. If VS Code's code looks different (another VSCodium version), that part is
# skipped with a warning (it shows in the CI summary); the rest still works (the command palette has the updater).
HELP_ITEM = re.compile(r'(\w+)\.appendMenuItem\((\w+)\.MenubarHelpMenu,\{command:\{id:\w+\.ID,title:\w+\(\d+,"Ask @vscode"\)')
NEVER = re.compile(r'when:([\w$]+)\.regex\("neverMatch",/doesNotMatch/\)')
SEARCH_VIEW = re.compile(r'\{(id:[\w$]+,containerIcon:[\w$]+,name:[\w$]+\(\d+,"Search"\),ctorDescriptor:)')
OUTPUT_VIEW = re.compile(r'\{(id:[\w$]+,name:[\w$]+\(\d+,"Output"\),containerIcon:[\w$]+,canMoveView:)')
HIDDEN_MARK = '/*kural-hidden*/'


def fingerprint(data):
    return base64.b64encode(hashlib.sha256(data).digest()).decode().rstrip("=")


def add_update_menu(text):
    if "kural.checkForUpdates" in text:
        return text
    m = HELP_ITEM.search(text)
    if not m:
        print("::warning::Help menu code not found; Help → Check for Updates not added")
        return text
    registry, ids = m.group(1), m.group(2)
    item = (f'{registry}.appendMenuItem({ids}.MenubarHelpMenu,{{command:{{id:"kural.checkForUpdates",'
            f'title:"Check for Updates..."}},group:"7_update",order:1}}),')
    return text[:m.start()] + item + text[m.start():]


# VSCodium's own content on the Welcome page, which is about VSCodium, not Kural:
#   - "VSCodium Announcements": VSCodium fetches its project's news from its GitHub (`announcements-extra.json`, when the
#     setting `workbench.welcomePage.extraAnnouncements` is on, as it is by default: "Securing VSCodium", "Use
#     minReleaseAge with auto-update"). The section isn't built or drawn at all, so nothing is fetched from VSCodium either.
#   - the "Get started with VSCodium" walkthrough (one step, a video link): its `when` condition becomes "false", so it
#     isn't listed. Kural's own "Get started with Kural" walkthrough (package.json "walkthroughs") is the one to follow.
# Each part is found by shape; if the code differs (another VSCodium), that part stays and a ::warning:: says so. Applying
# it again changes nothing.
ANNOUNCE_BUILD = re.compile(r',([\w$]+)=await this\.buildAnnouncementList\(\)')
SETUP_WALKTHROUGH = re.compile(r'(\{id:"Setup",title:[\w$]+\(\d+,null\),description:[\w$]+\(\d+,null\),isFeatured:!0,icon:[\w$]+,when:)"!isWeb"')
SETUP_HIDDEN = re.compile(r'\{id:"Setup",title:[\w$]+\(\d+,null\),description:[\w$]+\(\d+,null\),isFeatured:!0,icon:[\w$]+,when:"false"')


def drop_vscodium_welcome(text):
    build = ANNOUNCE_BUILD.search(text)
    if build:
        u = re.escape(build.group(1))
        with_walkthroughs = re.compile(r'(\.getDomElement\(\)),' + u + r'\.getDomElement\(\)\)')
        only_announcements = re.compile(r'(?<![\w$.])([\w$]+)\(([\w$]+),' + u + r'\.getDomElement\(\)\)')
        if len(with_walkthroughs.findall(text)) == 1 and len(only_announcements.findall(text)) == 1 and len(ANNOUNCE_BUILD.findall(text)) == 1:
            text = ANNOUNCE_BUILD.sub("", text, count=1)
            text = with_walkthroughs.sub(lambda m: m.group(1) + ")", text, count=1)
            text = only_announcements.sub(lambda m: f"{m.group(1)}({m.group(2)})", text, count=1)
        else:
            print("::warning::VSCodium's Welcome announcements not found as expected; \"VSCodium Announcements\" stays")
    elif "buildAnnouncementList" not in text:
        print("::warning::VSCodium's Welcome announcements code not found; nothing to remove (or it changed)")
    if SETUP_WALKTHROUGH.search(text):
        text = SETUP_WALKTHROUGH.sub(lambda m: m.group(1) + '"false"', text, count=1)
    elif not SETUP_HIDDEN.search(text):
        print("::warning::VSCodium's \"Get started with VSCodium\" walkthrough not found as expected; it stays")
    return text


def hide_builtin_views(text):
    if HIDDEN_MARK in text:
        return text
    never = NEVER.search(text)
    if not never:
        print("::warning::VS Code's \"never\" condition not found; its Search and Output views stay")
        return text
    cond = f'{HIDDEN_MARK}when:{never.group(1)}.regex("neverMatch",/doesNotMatch/),'
    for name, pattern in (("Search", SEARCH_VIEW), ("Output", OUTPUT_VIEW)):
        found = list(pattern.finditer(text))
        if len(found) != 1:
            print(f"::warning::VS Code's {name} view found {len(found)} times (not once); it stays")
            continue
        m = found[0]
        text = text[:m.start() + 1] + cond + text[m.start() + 1:]
    return text


# VS Code's Integrated Browser (a real browser tab: any site, an element picker, screenshots, console logs) sends what you
# pick to VS Code's own chat panel, which Kural doesn't have. Kural routes it to its own chat instead: the browser
# editor's "find the chat to attach to" step (`_revealChatWidgetForAttachment`) returns a small stand-in whose
# `addContext(...)` runs Kural's command `kural.browser.attach` (lib/browser/attach.js) with plain data (pictures as
# base64). Needed for that: the instantiation service (the 3rd constructor argument, kept as `this.__kural`), the
# command service's name in this build, and the element's own comment ("Comment on Elements", Cursor's "tell it what to
# change") added to the object that's attached. Each anchor is found by shape, with this build's own short names; if
# one isn't found (another VSCodium), the browser stays as it is and a ::warning:: says so.
BR_CTOR = re.compile(r'constructor\((\w+),(\w+),(\w+),(\w+),(\w+),(\w+),(\w+),(\w+),(\w+),(\w+),(\w+),(\w+),(\w+),(\w+)\)\{super\(\1\),'
                     r'(this\.telemetryService=\4,this\.logService=\5,this\.chatWidgetService=\6,this\.chatService=\7,)')
BR_REVEAL = re.compile(r'async _revealChatWidgetForAttachment\((\w+)=!1\)\{const (\w+)=await this\.chatWidgetService\.revealWidget\(\1\)\?\?this\.chatWidgetService\.lastFocusedWidget;'
                       r'return \2&&!\2\.viewModel&&await \w+\.toPromise\(\2\.onDidChangeViewModel\),\2\}')
BR_ELEMENT = re.compile(r'kind:"element",icon:(\w+\.fromId\(\w+\.layout\.id\)),ancestors:(\w+)\.ancestors')
BR_MARK = '/*kural-browser*/'
# The browser's "Add to Chat" actions (element, comment, console logs, screenshots) and their toolbar menu are shown only
# when VS Code's chat is enabled (context key `chatIsEnabled`, `G.enabled`), and Kural turns that off (it hides Copilot's
# chat). Inside the browser's code, from its first action to the setting registered after the menu, that condition becomes
# "always" (`<ContextKeyExpr>.true()`), so the buttons show and the actions run.
BR_REGION_START = re.compile(r'var \w+=(\w+)\.equals\("activeEditor",\w+\.EDITOR_ID\),\w+=\w+\(\d+,"Browser"\),\w+=new \w+\("browserElementSelectionMode"')
BR_REGION_END = '"workbench.browser.enableChatTools":{type:"boolean",default:!0,'
BR_ENABLED = re.compile(r'\b(\w+)\.enabled\b')


def route_browser_to_kural(text):
    if BR_MARK in text:
        return text
    cmd = re.search(r'(\w+)=\w+\("commandService"\)', text)
    inst = re.search(r'(\w+)=\w+\("instantiationService"\)', text)
    ctor, reveal, element = BR_CTOR.search(text), BR_REVEAL.search(text), BR_ELEMENT.search(text)
    if not (cmd and inst and ctor and reveal and element):
        print("::warning::VS Code's browser code not found as expected; its 'Add to Chat' stays as it is "
              f"(command service {bool(cmd)}, instantiation service {bool(inst)}, constructor {bool(ctor)}, "
              f"attach step {bool(reveal)}, element {bool(element)})")
        return text
    # The constructor's 3rd argument must be the instantiation service, and its 6th the chat widget service (the class's
    # decorators, after its long body, say so).
    chat = re.search(r'(\w+)=\w+\("chatWidgetService"\)', text)
    if not chat or f"__param(2,{inst.group(1)}),__param(3," not in text or not re.search(
            r"__decorate\(\[__param\(1,\w+\),__param\(2,%s\),__param\(3,\w+\),__param\(4,\w+\),__param\(5,%s\)," % (inst.group(1), chat.group(1)), text):
        print("::warning::VS Code's browser constructor changed; its 'Add to Chat' stays as it is")
        return text
    shim = (
        'async _revealChatWidgetForAttachment(e=!1){const k=this.__kural,'
        'b=u=>{u=u&&u.buffer instanceof Uint8Array?u.buffer:u;if(!u||!u.length)return"";let s="";for(let i=0;i<u.length;i+=32768)s+=String.fromCharCode.apply(null,u.subarray(i,i+32768));return btoa(s)};'
        'return{viewModel:{},inputEditor:{getModel:()=>null},focusInput(){},attachmentModel:{delete(){},addContext:(...c)=>{'
        'const items=c.map(x=>({kind:x.kind,name:x.name,fullName:x.fullName,value:typeof x.value=="string"?x.value:"",innerText:x.innerText,comment:x.comment,'
        'mime:x.mimeType||x.imageMimeType,image:b(x.imageData||(typeof x.value=="string"?null:x.value))}));'
        f'k.invokeFunction(a=>a.get({cmd.group(1)}).executeCommand("kural.browser.attach",items))}}}}}}}}{BR_MARK}')
    # The condition: the chat service's `<Class>.enabled` key; its name and the expression class (`and`, `true`) are read
    # from the first browser action's own precondition.
    gate = re.search(r'precondition:(\w+)\.and\(\w+,\w+,\w+\.negate\(\),(\w+)\.enabled\),toggled:', text)
    start = BR_REGION_START.search(text)
    end = text.find(BR_REGION_END, start.end()) if start else -1
    if not (gate and start and end > 0 and re.search(re.escape(gate.group(1)) + r"\.true\(\)", text)):
        print("::warning::VS Code's browser actions not found as expected; the browser's 'Add to Chat' buttons stay hidden")
    else:
        region = text[start.start():end]
        text = text[:start.start()] + re.sub(r'\b' + re.escape(gate.group(2)) + r'\.enabled\b', gate.group(1) + ".true()", region) + text[end:]
        reveal = BR_REVEAL.search(text)
    text = text[:reveal.start()] + shim + text[reveal.end():]
    text = BR_CTOR.sub(lambda m: m.group(0).replace("super(" + m.group(1) + "),", "super(" + m.group(1) + "),this.__kural=" + m.group(3) + ",", 1), text, count=1)
    text = BR_ELEMENT.sub(lambda m: f'kind:"element",comment:{m.group(2)}.comment,icon:{m.group(1)},ancestors:{m.group(2)}.ancestors', text, count=1)
    return text


def patch_workbench(app):
    rel = "vs/workbench/workbench.desktop.main.js"
    js_path, pj_path = os.path.join(app, "out", rel), os.path.join(app, "product.json")
    with open(js_path, "rb") as f:
        data = f.read()
    product = load(pj_path)
    sums = product.get("checksums", {})
    if sums.get(rel) != fingerprint(data):
        print("::warning::unexpected workbench fingerprint; VS Code's code left as it is (no Help → Check for Updates, Search and Output stay)")
        return
    text = data.decode("utf-8")
    new = route_browser_to_kural(hide_builtin_views(add_update_menu(drop_vscodium_welcome(text))))
    if new == text:
        return
    data = new.encode("utf-8")
    with open(js_path, "wb") as f:
        f.write(data)
    sums[rel] = fingerprint(data)
    save(pj_path, product)


# The editor's own texts (command and menu names, settings descriptions, messages like "Please restart VSCodium before
# reinstalling…") are in out/nls.messages.json, and VSCodium's build put its name in about a hundred of them: they say Kural.
# Only the word on its own, never inside a web address (github.com/VSCodium/vscodium stays as it is, or the link would
# break); the issue reporter's "review the guidance we provide" links go to Kural's contributing guide instead of VSCodium's
# and Microsoft's wikis. The file isn't in product.json's "checksums", so VS Code doesn't mind. Applying it again changes nothing.
VSCODIUM_WORD = re.compile(r'(?<![/\w])VSCodium(?![\w/])')
# (The issue reporter has the guidance link twice: as HTML, to VSCodium's wiki, and as markdown, to Microsoft's.)
GUIDANCE_WIKIS = ("https://github.com/VSCodium/vscodium/wiki/Submitting-Bugs-and-Suggestions",
                  "https://github.com/microsoft/vscode/wiki/Submitting-Bugs-and-Suggestions")


def rebrand_messages(app):
    p = os.path.join(app, "out", "nls.messages.json")
    if not os.path.exists(p):
        print("::warning::out/nls.messages.json not found; the editor's texts keep saying VSCodium")
        return
    messages = load(p)
    if not isinstance(messages, list):
        print("::warning::out/nls.messages.json looks different; the editor's texts keep saying VSCodium")
        return
    def kural(m):
        for wiki in GUIDANCE_WIKIS:
            m = m.replace(wiki, f"{REPO}/blob/main/CONTRIBUTING.md")
        return VSCODIUM_WORD.sub(TITLE, m)
    new = [kural(m) if isinstance(m, str) else m for m in messages]
    if new == messages:
        return
    with open(p, "w", encoding="utf-8") as f:
        json.dump(new, f, ensure_ascii=False, separators=(",", ":"))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])

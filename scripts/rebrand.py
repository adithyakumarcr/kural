#!/usr/bin/env python3
"""Turns an unpacked VSCodium into Kural. Shared by the Linux, macOS and Windows builds.

Usage: rebrand.py <app-dir> <linux|mac|win>
  <app-dir> is VSCodium's resources/app folder (the one containing product.json).
"""
import base64, hashlib, json, os, re, shutil, sys, uuid

# Messages have → and … in them: a Windows console (cp1252) can't print those and rebrand stopped with an error.
for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure"):
        _stream.reconfigure(encoding="utf-8")
from runtime_dependencies import install as install_runtime_dependencies

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NAME, TITLE, LONG = "kural", "Kural", "Kural Code Editor"
REPO = "https://github.com/adithyakumarcr/kural"


def load(p):
    with open(p, encoding="utf-8") as f:
        return json.load(f)


def save(p, d):
    with open(p, "w", encoding="utf-8", newline="\n") as f:   # (the same file on every system)
        json.dump(d, f, indent="\t")


def main(app, platform):
    install_runtime_dependencies(app)
    # 1. Names, data folders, url scheme — so Kural never shares settings with VS Code/VSCodium.
    p = os.path.join(app, "product.json")
    d = load(p)
    d.update(nameShort=TITLE, nameLong=LONG, applicationName=NAME,
             dataFolderName=f".{NAME}", sharedDataFolderName=f".{NAME}-shared", linuxIconName=NAME, urlProtocol=NAME,
             # The window's id on Linux (Wayland app_id): VS Code names it after /usr/share/applications/<this>.desktop.
             # VSCodium's "com.visualstudio.CodeOSS" gave Kural a second dock icon (a gear) beside kural.desktop's.
             linuxDesktopName=NAME,
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
    # ...and the notices for the parts made by others (VSCodium, Electron, Codicons), beside it.
    shutil.copy(os.path.join(ROOT, "THIRD_PARTY_NOTICES.md"), os.path.join(ext, NAME, "THIRD_PARTY_NOTICES.md"))
    # The release notes: "What's New in Kural" shows them after an update (extension/lib/whats-new), offline too.
    shutil.copy(os.path.join(ROOT, "RELEASE_NOTES.md"), os.path.join(ext, NAME, "RELEASE_NOTES.md"))

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
    #    (Kural's Search & Ask side bar does text search; Kural's log opens with "Kural: Show Log"), Extensions | Plugins,
    #    and VSCodium's own content off the Welcome page.
    patch_workbench(app)
    # 6b. The microphone for Kural's chat only (voice input): its webview frame, the inner frame, and the main process's
    #     permission answer for webviews (audio only).
    patch_webview_microphone(app)
    # 7. The editor's own texts (menus, settings, messages) say "VSCodium": they say Kural.
    rebrand_messages(app)
    print(f"rebranded {app} for {platform}")


# Kural changes these things in VS Code's own code (workbench.desktop.main.js):
#   - VSCodium's own content off the Welcome page (see drop_vscodium_welcome).
#   - the Integrated Browser's "Add to Chat" goes to Kural's chat (route_browser_to_kural).
#   - notifications from the system for Kural's chat (add_os_toast).
#   - VS Code's Run and Debug, Debug Console and Ports hidden unless kural.showDebugViews is on (hide_debug_views).
#   - the Extensions side bar's second tab, Plugins: Kural's AI plugins view (add_plugins_tab).
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
# (VS Code 1.140's bundle writes statements with ";" where 1.135's used ",", and "let" for "const": both are accepted.)
BR_CTOR = re.compile(r'constructor\((\w+),(\w+),(\w+),(\w+),(\w+),(\w+),(\w+),(\w+),(\w+),(\w+),(\w+),(\w+),(\w+),(\w+)\)\{super\(\1\)([,;])'
                     r'(this\.telemetryService=\4[,;]this\.logService=\5[,;]this\.chatWidgetService=\6[,;]this\.chatService=\7[,;])')
BR_REVEAL = re.compile(r'async _revealChatWidgetForAttachment\((\w+)=!1\)\{(?:const|let) (\w+)=await this\.chatWidgetService\.revealWidget\(\1\)\?\?this\.chatWidgetService\.lastFocusedWidget;'
                       r'return \2&&!\2\.viewModel&&await \w+\.toPromise\(\2\.onDidChangeViewModel\),\2\}')
# VS Code 1.140+: a comment on an element is also written into the chat's input box as a reference
# (_insertElementCommentReference). Kural's chat takes the comment with the element itself, so for Kural's stand-in
# widget (`__kural`) that step just says "done". Older builds don't have it.
BR_COMMENT = re.compile(r'_insertElementCommentReference\((\w+),\w+,\w+,\w+,\w+,\w+\)\{')
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
    # (Decorators: "__decorate([__param(1,a),__param(2,b),…" in 1.135; minified "I([h(1,a),h(2,b),…" in 1.140.)
    chat = re.search(r'(\w+)=\w+\("chatWidgetService"\)', text)
    if not chat or not re.search(
            r"\w+\(\[(\w+)\(1,\w+\),\1\(2,%s\),\1\(3,\w+\),\1\(4,\w+\),\1\(5,%s\)," % (re.escape(inst.group(1)), re.escape(chat.group(1))), text):
        print("::warning::VS Code's browser constructor changed; its 'Add to Chat' stays as it is")
        return text
    shim = (
        'async _revealChatWidgetForAttachment(e=!1){const k=this.__kural,'
        'b=u=>{u=u&&u.buffer instanceof Uint8Array?u.buffer:u;if(!u||!u.length)return"";let s="";for(let i=0;i<u.length;i+=32768)s+=String.fromCharCode.apply(null,u.subarray(i,i+32768));return btoa(s)};'
        'return{__kural:!0,viewModel:{},inputEditor:{getModel:()=>null},focusInput(){},attachmentModel:{delete(){},addContext:(...c)=>{'
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
    text = BR_CTOR.sub(lambda m: m.group(0).replace("super(" + m.group(1) + ")" + m.group(15), "super(" + m.group(1) + ")" + m.group(15) + "this.__kural=" + m.group(3) + m.group(15), 1), text, count=1)
    text = BR_COMMENT.sub(lambda m: m.group(0) + f"if({m.group(1)}&&{m.group(1)}.__kural)return!0;", text, count=1)
    text = BR_ELEMENT.sub(lambda m: f'kind:"element",comment:{m.group(2)}.comment,icon:{m.group(1)},ancestors:{m.group(2)}.ancestors', text, count=1)
    return text


# VS Code's Run and Debug side bar, Debug Console panel and Ports panel are hidden unless the setting
# `kural.showDebugViews` is on (Adithya: off by default, to keep Kural simple). Every view registered in those three
# containers (VS Code's own and extensions' alike) gets "and the setting is on" added to its condition (`when`), in the
# views registry's `addViews` (so it doesn't matter how each view is written); the debug ones also show while you debug
# (`inDebugMode`), so F5 still shows Variables, Call Stack and the Debug Console. A container with no view to show is
# hidden (`hideIfEmpty`: Debug Console and Ports have it; Run and Debug gets it). Turning the setting on brings them back
# at once (`config.*` context keys follow the settings). Found by shape; a miss -> ::warning::, and they stay.
DEBUG_ADD_VIEWS = re.compile(r'addViews\(([\w$]+),([\w$]+)\)\{(?=let [\w$]+=this\._views\.get\(\2\);)')
DEBUG_RUN_CONTAINER = re.compile(r'registerViewContainer\(\{(?=id:[\w$]+,title:[\w$]+\(\d+,"Run and Debug"\),openCommandActionDescriptor:)')
DEBUG_IDS = ("workbench.view.debug", "workbench.panel.repl", "~remote.forwardedPortsContainer")
DEBUG_MARK = '/*kural-debug-views*/'


def hide_debug_views(text):
    if DEBUG_MARK in text:
        return text
    never, add, run = NEVER.search(text), list(DEBUG_ADD_VIEWS.finditer(text)), list(DEBUG_RUN_CONTAINER.finditer(text))
    ids = all(f'"{i}"' in text for i in DEBUG_IDS)
    if not (never and len(add) == 1 and len(run) == 1 and ids):
        print("::warning::VS Code's views code not found as expected; Run and Debug, Debug Console and Ports stay "
              f"(condition class {bool(never)}, addViews {len(add)}, Run and Debug {len(run)}, ids {ids})")
        return text
    c, views, container = never.group(1), add[0].group(1), add[0].group(2)
    code = (f'{DEBUG_MARK}try{{const _kd=globalThis.__kuralDebugViews||(globalThis.__kuralDebugViews=new WeakSet),_kp={container}&&{container}.id;'
            f'if({"||".join(f"_kp===" + json.dumps(i) for i in DEBUG_IDS)})for(const _kv of {views})try{{if(_kv&&!_kd.has(_kv)){{'
            f'const _kk={c}.has("config.kural.showDebugViews"),_ks=_kp[0]==="~"?_kk:{c}.or(_kk,{c}.has("inDebugMode"));'
            f'_kv.when=_kv.when?{c}.and(_kv.when,_ks):_ks;_kd.add(_kv)}}}}catch{{}}}}catch{{}}')
    text = text[:add[0].end()] + code + text[add[0].end():]
    run = DEBUG_RUN_CONTAINER.search(text)
    return text[:run.end()] + "hideIfEmpty:!0," + text[run.end():]


# Extensions | Plugins | Connectors: VS Code's Extensions side bar gets two more tabs, Plugins (Kural's view
# "kural.plugins": the AI plugins of the chat's AI, extension/lib/plugins) and Connectors (view "kural.connectors": its
# MCP servers, extension/lib/connectors; Adithya, 22 Oct 2026), with the same switch as Kural's Search & Ask. Four parts:
#   1. the views extension point lets an extension add views to "extensions" (VS Code allows only explorer, debug, scm,
#      remote); Kural's package.json adds kural.plugins there, shown when `kural.extensionsTab == plugins`.
#   2. VS Code's own views in that side bar (Installed, Popular, search results…) get `kural.extensionsTab != plugins`
#      and `!= connectors`,
#      in the views registry's addViews (after hide_debug_views' code there, so apply this one after it).
#      Kural's own view gets the side bar's title for when it's the only view showing (else "Extensions & Plugins: Plugins").
#   3. the side bar's create() puts the switch above its search box (lined up with it: the header's own padding) and keeps
#      the choice in the side bar's own saved state; layout() leaves room for it, and on Plugins the search box hides (its
#      height counts 0); refresh() (the title bar's Refresh) refreshes the plugins while Plugins shows.
#   4. a command `_kural.extensionsTabs` ("plugins" | "extensions" | "connectors" → switches; → {tab, tabs}): "Kural: Show
#      Plugins" uses it, and Kural looks for it to know this patch is there (without it, Plugins has a side bar of its
#      own; a patch whose `tabs` has no "connectors", an older Kural's, puts Connectors in that side bar too).
# The side bar's title becomes "Extensions & Plugins" (rebrand_messages). All four parts are found by shape; if one is
# missing (another VSCodium), nothing is changed and a ::warning:: says so. Applying it again changes nothing.
PT_MARK = "/*kural-plugins-tab*/"
PT_CONTAINER = re.compile(r'getViewContainer\(([\w$]+)\)\{switch\(\1\)\{(?=case"explorer":return this\.viewContainersRegistry\.get\()')
PT_ADD_VIEWS = re.compile(r'addViews\(([\w$]+),([\w$]+)\)\{')
PT_CREATE = re.compile(r'create\(([\w$]+)\)\{\1\.classList\.add\("extensions-viewlet"\)[,;]this\.root=\1;')
PT_LAYOUT = re.compile(r'this\.header\.style\.height=`\$\{([\w$]+)\}px`([,;])super\.layout\(new ([\w$]+)\(([\w$]+)\.width,\4\.height-\1\)\)')
PT_REFRESH = re.compile(r'async refresh\(\)\{(?=await this\.updateInstalledExtensionsContexts\(\))')
# (The outer row has padding, not a margin: a first child's top margin escapes its parent, and 6 px went missing below.)
PT_CSS = (".extensions-viewlet>.kural-ext-tabs{height:34px;box-sizing:border-box;padding:6px 8px 0}"
          ".kural-ext-seg{display:flex;gap:2px;height:28px;box-sizing:border-box;padding:2px;"
          "border:1px solid var(--vscode-widget-border,rgba(128,128,128,.22));border-radius:7px;background:var(--vscode-input-background)}"
          # (Each tab as wide as its words, the rest shared: equal thirds cut "Connectors" off in a side bar of ~300 px.)
          ".kural-ext-tab{flex:1 1 auto;display:inline-flex;align-items:center;justify-content:center;gap:4px;min-width:0;padding:0 6px;border:0;"
          "border-radius:5px;background:none;color:var(--vscode-descriptionForeground);font:inherit;font-size:12px;cursor:pointer;white-space:nowrap;overflow:hidden}"
          ".kural-ext-tab:hover{color:var(--vscode-foreground)}.kural-ext-tab:focus-visible{outline:1px solid var(--vscode-focusBorder);outline-offset:-1px}"
          ".kural-ext-tab.on{background:color-mix(in srgb,#8b6cef 25%,transparent);color:var(--vscode-foreground);font-weight:600}"
          ".vs .kural-ext-tab.on,.hc-light .kural-ext-tab.on{background:color-mix(in srgb,#6447d6 25%,transparent)}"
          ".kural-ext-tab .codicon{font-size:14px;flex-shrink:0}.kural-ext-label{overflow:hidden;text-overflow:ellipsis}.extensions-viewlet.kural-plugins-on>.header{display:none}"
          # (VS Code sizes the views' area as 100% minus its 41 px header in CSS: minus the switch's 34 px too.)
          ".extensions-viewlet.kural-tabs>.extensions{height:calc(100% - 75px)}.extensions-viewlet.kural-tabs.kural-plugins-on>.extensions{height:calc(100% - 34px)}"
          # (Adithya, 27 Oct 2026: no brand-colored Install button on every row: a download icon, only under the pointer or the
          # keyboard. The words are hidden with font-size 0; the icon is the codicon cloud-download, \eac2. "Installing" keeps its words.)
          ".extensions-viewlet .extension-list-item .extension-action.label.prominent.install:not(.installing){background:transparent!important;"
          "color:var(--vscode-foreground)!important;font-size:0!important;padding:0!important;width:22px;height:22px;display:inline-flex;"
          "align-items:center;justify-content:center;opacity:0}"
          ".extensions-viewlet .extension-list-item .extension-action.label.prominent.install:not(.installing)::before{content:'\\eac2';"
          "font:normal 16px/1 codicon}"
          ".extensions-viewlet .monaco-list-row:hover .extension-action.label.prominent.install:not(.installing),"
          ".extensions-viewlet .monaco-list-row.focused .extension-action.label.prominent.install:not(.installing),"
          ".extensions-viewlet .monaco-list-row.selected .extension-action.label.prominent.install:not(.installing),"
          ".extensions-viewlet .extension-list-item .extension-action.label.prominent.install:not(.installing):focus-visible{opacity:1}"
          ".extensions-viewlet .extension-list-item .extension-action.label.prominent.install:not(.installing):hover"
          "{background:var(--vscode-toolbar-hoverBackground)!important}")
# (Inside create(): `this` is the side bar. Plain DOM calls, no minified helpers, so nothing else has to be found.)
PT_CREATE_CODE = PT_MARK + (
    'try{const r=this.root,doc=r.ownerDocument,bar=doc.createElement("div"),seg=doc.createElement("div");bar.className="kural-ext-tabs";'
    'seg.className="kural-ext-seg";seg.setAttribute("role","tablist");seg.setAttribute("aria-label","Extensions, Plugins or Connectors");'
    'const mk=(id,ic,label)=>{const b=doc.createElement("button");b.className="kural-ext-tab";b.setAttribute("role","tab");b.dataset.tab=id;b.title=label;'
    'const i=doc.createElement("span");i.className="codicon codicon-"+ic;const l=doc.createElement("span");l.className="kural-ext-label";l.textContent=label;b.append(i,l);return b};'
    'const T=["extensions","plugins","connectors"],B={extensions:mk("extensions","extensions","Extensions"),plugins:mk("plugins","sparkle","Plugins"),connectors:mk("connectors","plug","Connectors")};'
    'seg.append(B.extensions,B.plugins,B.connectors);bar.append(seg);r.append(bar);r.classList.add("kural-tabs");'
    'const key=this.contextKeyService.createKey("kural.extensionsTab","extensions");'
    'const set=(t,focus)=>{t=T.includes(t)?t:"extensions";this.__kuralTab=t;key.set(t);try{this.searchViewletState["kural.tab"]=t}catch{}'
    'for(const k of T){B[k].classList.toggle("on",t===k);B[k].setAttribute("aria-selected",String(t===k))}'
    'r.classList.toggle("kural-plugins-on",t!=="extensions");if(this._dimension)this.layout(this._dimension);'
    'if(focus)t==="extensions"?this.searchBox&&this.searchBox.focus():this.commandService.executeCommand("kural."+t+".focus")};'
    'for(const k of T)B[k].addEventListener("click",()=>set(k,!0));'
    'seg.addEventListener("keydown",x=>{if(x.key==="ArrowLeft"||x.key==="ArrowRight"){x.preventDefault();'
    'const n=T[(T.indexOf(this.__kuralTab)+(x.key==="ArrowRight"?1:2))%3];set(n,!1);B[n].focus()}});'
    'this.__kuralTabs=bar;this.__kuralSet=set;'
    # (Lined up with the search box below: the header's own side padding, read once it exists.)
    'this.__kuralLayout=h=>{if(!this.__kuralAligned&&this.header)try{const cs=doc.defaultView.getComputedStyle(this.header);'
    'bar.style.paddingLeft=cs.paddingLeft;bar.style.paddingRight=cs.paddingRight;this.__kuralAligned=!0}catch{}'
    'return(this.__kuralTab==="extensions"?h:0)+(bar.offsetHeight||34)};'
    'globalThis.__kuralExtView=this;const want=globalThis.__kuralExtWant;globalThis.__kuralExtWant=void 0;'
    'set(want||this.searchViewletState&&this.searchViewletState["kural.tab"],!1);'
    'if(!doc.getElementById("kural-ext-tabs-css")){const s=doc.createElement("style");s.id="kural-ext-tabs-css";s.textContent='
    + json.dumps(PT_CSS) + ';doc.head.append(s)}}catch(x){console.error("kural: the Plugins tab",x)}')
PT_COMMAND_CODE = PT_MARK + (
    'C.registerCommand("_kural.extensionsTabs",(a,t)=>{const v=globalThis.__kuralExtView;'
    'if(t==="plugins"||t==="extensions"||t==="connectors"){if(v&&v.__kuralSet)v.__kuralSet(t,!0);else globalThis.__kuralExtWant=t}'
    'return{tab:v&&v.__kuralTab||globalThis.__kuralExtWant||"extensions",tabs:["extensions","plugins","connectors"]}});')


def add_plugins_tab(text):
    if PT_MARK in text:
        return text
    never, container, create, layout = NEVER.search(text), list(PT_CONTAINER.finditer(text)), list(PT_CREATE.finditer(text)), list(PT_LAYOUT.finditer(text))
    refresh, commands, end = list(PT_REFRESH.finditer(text)), TOAST_COMMANDS.findall(text), list(TOAST_END.finditer(text))
    # The views registry's addViews: the one that reads this._views.get(<container>) first (after hide_debug_views' code).
    adds = []
    for m in PT_ADD_VIEWS.finditer(text):
        nxt = re.compile(r'let [\w$]+=this\._views\.get\(' + re.escape(m.group(2)) + r'\);').search(text, m.end(), m.end() + 3000)
        if nxt and (nxt.start() == m.end() or text.startswith(DEBUG_MARK, m.end())):
            adds.append((m, nxt))
    found = {"condition class": bool(never), "views extension point": len(container) == 1, "addViews": len(adds) == 1,
             "side bar create": len(create) == 1, "side bar layout": len(layout) == 1, "side bar refresh": len(refresh) == 1,
             "command registry": len(commands) == 1, "end": len(end) == 1}
    if not all(found.values()):
        print("::warning::VS Code's Extensions side bar not found as expected; no Plugins tab there (Plugins gets its own side bar) ("
              + ", ".join(f"{k} {'ok' if v else 'missing'}" for k, v in found.items()) + ")")
        return text
    c = never.group(1)
    views, cont = adds[0][0].group(1), adds[0][0].group(2)
    view_code = (f'{PT_MARK}try{{const _kx=globalThis.__kuralExtViews||(globalThis.__kuralExtViews=new WeakSet);'
                 f'if({cont}&&{cont}.id==="workbench.view.extensions")for(const _kv of {views})try{{if(!_kv||_kx.has(_kv))continue;'
                 f'if(_kv.id==="kural.plugins"||_kv.id==="kural.connectors"){{const _kt={cont}.title;_kv.singleViewPaneContainerTitle=typeof _kt=="string"?_kt:_kt&&_kt.value||"Extensions";_kx.add(_kv);continue}}'
                 f'const _kn={c}.and({c}.notEquals("kural.extensionsTab","plugins"),{c}.notEquals("kural.extensionsTab","connectors"));_kv.when=_kv.when?{c}.and(_kv.when,_kn):_kn;_kx.add(_kv)}}catch{{}}}}catch{{}}')
    # From the end of the file backwards, so each place found above stays where it was.
    edits = [
        (end[0].start() + 1, end[0].start() + 1, PT_COMMAND_CODE.replace("C.registerCommand", commands[0] + ".registerCommand")),
        (layout[0].start(), layout[0].end(), f'this.header.style.height=`${{{layout[0].group(1)}}}px`{layout[0].group(2)}super.layout(new {layout[0].group(3)}('
                                             f'{layout[0].group(4)}.width,{layout[0].group(4)}.height-(this.__kuralLayout?this.__kuralLayout({layout[0].group(1)}):{layout[0].group(1)})))'),
        (refresh[0].end(), refresh[0].end(), 'if(this.__kuralTab==="plugins"||this.__kuralTab==="connectors")return void await this.commandService.executeCommand("kural."+this.__kuralTab+".refresh");'),
        (create[0].end(), create[0].end(), PT_CREATE_CODE),
        (adds[0][1].start(), adds[0][1].start(), view_code),
        (container[0].end(), container[0].end(), 'case"extensions":return this.viewContainersRegistry.get("workbench.view.extensions");'),
    ]
    for start, stop, new in sorted(edits, key=lambda e: e[0], reverse=True):
        text = text[:start] + new + text[stop:]
    return text


# Notifications from the system (a Mac banner, a Windows toast, a Linux notification) that say Kural: VS Code's own
# `hostService.showToast` (its chat uses it when an answer arrives in a window you aren't looking at) shows an Electron
# notification from Kural's main process. Extensions can't reach it, so a command is added that does:
#   executeCommand("_kural.osToast", {title, body?, id?, actions?, silent?, timeout?, attention?})
#     -> {clicked, actionIndex?, supported}. A click (or a button) brings that Kural window to the front first.
#     id: a new toast with the same id replaces the old one. timeout (ms): withdrawn after it. attention: when the
#     window isn't focused, the Dock icon bounces once (Mac) / the taskbar button flashes (Windows), like VS Code's own.
#   executeCommand("_kural.osToastClear", {id?}) withdraws one (no id: all of Kural's toasts) -> how many.
# Added at the end of the file (everything it needs exists by then), found by shape; a miss -> ::warning::, and the
# chat's notifications fall back to Kural's own (the command isn't there).
TOAST_HOST = re.compile(r'(?<![\w$.])([\w$]+)=[\w$]+\("hostService"\)')
# (1.140's bundle: ";" between statements and "let" where 1.135 had "," and "const": both accepted.)
TOAST_COMMANDS = re.compile(r'(?<![\w$.])([\w$]+)=new class\{constructor\(\)\{this\._commands=new Map[,;]this\._onDidRegisterCommand=')
TOAST_METHOD = re.compile(r'async showToast\([\w$]+,[\w$]+\)\{(?:const|let) [\w$]+=[\w$]+\(\),[\w$]+=[\w$]+\.onCancellationRequested\(\(\)=>this\.nativeHostService\.clearToast\(')
TOAST_END = re.compile(r';(export\{[\w$]+ as main\})')
TOAST_MARK = '/*kural-toast*/'
# (C = the command registry, H = the host service's id; a cancellation token of its own, so no minified class is needed)
TOAST_CODE = TOAST_MARK + (
    '(()=>{const T=new Map,'
    'tok=()=>{let f=[],c=!1;return{token:{get isCancellationRequested(){return c},onCancellationRequested(l,s){const e=()=>l.call(s);'
    'if(c){e();return{dispose(){}}}f.push(e);return{dispose(){f=f.filter(x=>x!==e)}}}},'
    'cancel(){if(c)return;c=!0;const g=f;f=[];for(const e of g)try{e()}catch{}}}};'
    'C.registerCommand("_kural.osToast",async(a,o)=>{o=o||{};const h=a.get(H),w=globalThis,s=tok(),'
    'id=typeof o.id=="string"&&o.id?o.id:"#"+Math.random(),old=T.get(id);old&&old();T.set(id,s.cancel);'
    'const t=o.timeout>0?setTimeout(s.cancel,o.timeout):void 0;'
    'try{if(o.attention&&!w.document.hasFocus())await h.focus(w,{mode:1});'
    'const r=await h.showToast({title:String(o.title||"Kural"),body:o.body?String(o.body):void 0,silent:!!o.silent,'
    'actions:Array.isArray(o.actions)&&o.actions.length?o.actions.map(String):void 0},s.token)||{},'
    'n=typeof r.actionIndex=="number",clicked=!!(r.clicked||n);'
    'if(clicked&&o.focus!==!1)await h.focus(w,{mode:2});'
    'return{clicked,actionIndex:n?r.actionIndex:void 0,supported:r.supported!==!1}}'
    'finally{clearTimeout(t);T.get(id)===s.cancel&&T.delete(id)}});'
    'C.registerCommand("_kural.osToastClear",(a,o)=>{const ids=o&&o.id?[o.id]:[...T.keys()];let n=0;'
    'for(const i of ids){const d=T.get(i);d&&(d(),n++)}return n})})();')


def add_os_toast(text):
    if TOAST_MARK in text:
        return text
    host, commands, end = TOAST_HOST.findall(text), TOAST_COMMANDS.findall(text), list(TOAST_END.finditer(text))
    if len(host) != 1 or len(commands) != 1 or len(end) != 1 or not TOAST_METHOD.search(text):
        print("::warning::VS Code's notification code not found as expected; Kural's notifications stay inside the window "
              f"(host service {len(host)}, command registry {len(commands)}, end {len(end)}, showToast {bool(TOAST_METHOD.search(text))})")
        return text
    code = TOAST_CODE.replace("C.registerCommand", commands[0] + ".registerCommand").replace("a.get(H)", f"a.get({host[0]})")
    return text[:end[0].start() + 1] + code + text[end[0].start() + 1:]


# Right-click on the activity bar → "Workspace Color..." (runs the command kural.workspaceColor). Extensions can't add to that
# menu: VS Code builds it by hand in getActivityBarContextMenuActions() (Activity Bar Position submenu, Compact/Default size,
# then the "Hide Activity Bar" style actions; it is not a MenuId an extension could contribute to; ActivityBarPositionMenu is only the
# submenu's contents). The item is pushed onto that list just before the function's final `return s.push(...)`. Found by the
# function's name (a class method name, kept by the minifier) and the ICommandService id (`X=Y("commandService")`). Any miss →
# a ::warning:: and the item is simply not there (the command palette has the command). Applying it again changes nothing.
WSCOLOR_MARK = "/*kural-workspace-color*/"
WSCOLOR_SERVICE = re.compile(r'(?<![\w$.])([\w$]+)=[\w$]+\("commandService"\)')
WSCOLOR_PLAIN = re.compile(r'getActivityBarContextMenuActions\(\)\{(?:(?!getActivityBarContextMenuActions).){0,2000}?[,\s]([\w$]+)=\[new [\w$]+\("workbench\.action\.activityBar\.position"')


def add_workspace_color_item(text):
    if WSCOLOR_MARK in text:
        return text
    func = WSCOLOR_PLAIN.search(text)
    services = WSCOLOR_SERVICE.findall(text)
    ret = func and text.find(f"return {func.group(1)}.push(", func.end(), func.end() + 2500)
    helper = func and re.search(r'return ' + re.escape(func.group(1)) + r'\.push\(([\w$]+)\(\{id:', text[ret:ret + 200]) if ret and ret > 0 else None
    if not func or len(set(services)) != 1 or not helper or "this.instantiationService.invokeFunction" not in text[ret:ret + 300]:
        print("::warning::Activity bar context menu code not found; right-click → Workspace Color... not added "
              f"(function {bool(func)}, command service {len(set(services))}, item {bool(helper)})")
        return text
    lst, mk = func.group(1), helper.group(1)
    item = (f'{WSCOLOR_MARK}{lst}.push({mk}({{id:"kural.workspaceColor",label:"Workspace Color...",'
            f'run:()=>this.instantiationService.invokeFunction(kx=>kx.get({services[0]}).executeCommand("kural.workspaceColor"))}})),')
    # `return s.push(a),...` → `return /*mark*/s.push(item),s.push(a),...`  (a comma expression keeps the original return value)
    start = ret + len("return ")
    return text[:start] + item + text[start:]


# ---- The Projects bar (extension/lib/projects: the view "kural.projects" in the activity bar container "kural-projects", so
# its workbench id is workbench.view.extension.kural-projects). Four patches, each found by shape, each a no-op with a
# ::warning:: when VS Code's code looks different, each applied once (a marker comment). Apply them after hide_debug_views and
# add_plugins_tab: those two put their code at the start of the views registry's addViews, and one of them finds its place there. ----
PROJECTS_CONTAINER = "workbench.view.extension.kural-projects"
PROJECTS_VIEW = "kural.projects"

# 1. No folder open: the Explorer shows "You have not yet opened a folder" with Open Folder / Clone Repository. The Projects bar
# is where you start from, so that text is dropped: the Explorer's own registrations (`R.registerViewWelcomeContent(<EmptyView>.ID,
# {...})`, one per case: workspace, remote, no folder, editor open) are switched off with `0&&`, and the viewsWelcome extension point
# (the Git extension's "Clone Repository" is one of those) no longer maps `view: "explorer"` onto that view. The empty view's own
# class is found from its id ("workbench.explorer.emptyView"), which is also the view id the extension point's table names.
EMPTY_ID = "workbench.explorer.emptyView"
EMPTY_MARK = "/*kural-explorer-empty*/"
EMPTY_CLASS = re.compile(r'([\w$]+)=class(?: [\w$]+)? extends [\w$.]+\{')
EMPTY_TABLE = re.compile(r'(\{explorer:)"' + re.escape(EMPTY_ID) + r'"(,debug:"workbench\.debug\.welcome")')


def drop_explorer_empty_view(text):
    if EMPTY_MARK in text:
        return text
    at = text.find('static{this.ID="' + EMPTY_ID + '"}')
    cls = list(EMPTY_CLASS.finditer(text[max(0, at - 2000):at])) if at > 0 else []
    name = cls[-1].group(1) if cls else None
    regs = list(re.finditer(r'(?<![\w$.])([\w$]+)\.registerViewWelcomeContent\(' + re.escape(name) + r'\.ID,', text)) if name else []
    table = list(EMPTY_TABLE.finditer(text))
    if not regs or len(table) != 1:
        print("::warning::VS Code's Explorer welcome text not found as expected; the Explorer keeps 'You have not yet opened a folder' "
              f"(empty view class {bool(name)}, registrations {len(regs)}, extension table {len(table)})")
        return text
    for i, m in reversed(list(enumerate(regs))):
        text = text[:m.start()] + (EMPTY_MARK if i == 0 else "") + "0&&" + text[m.start():]
    # (An id nothing registers: the table still lists "explorer", so a viewsWelcome contribution for it stays valid, and unused.)
    return EMPTY_TABLE.sub(lambda m: m.group(1) + '"kural.explorer.noWelcome"' + m.group(2), text, count=1)


# 2. The side bar opens the Projects bar at every window start (VS Code's own choice is the Explorer, or the one remembered), and
# that container comes first in the activity bar. The first: the window's layout state picks the side bar's container from the
# saved `workbench.sidebar.activeviewletid` just before it stores it as the one to restore (`a?...containerToRestore.sideBar=a:
# ...SIDEBAR_HIDDEN`: a hidden side bar stays hidden); we set it right there. The second: an extension's view container gets its
# order from a counter after VS Code's own, so registerCustomViewContainer gives this one -1000 (the activity bar puts a new one
# in order; one it remembered keeps its place, which is first from the second start on). All or nothing.
PD_MARK = "/*kural-projects-default*/"
PD_RESTORE = re.compile(r'([\w$]+)\?this\.state\.initialization\.views\.containerToRestore\.sideBar=\1:this\.stateModel\.setRuntimeValue\([\w$]+\.SIDEBAR_HIDDEN,!0\)')
PD_ORDER = re.compile(r'registerCustomViewContainer\(([\w$]+),([\w$]+),([\w$]+),([\w$]+),([\w$]+),([\w$]+)\)\{(?=let [\w$]+=this\.viewContainersRegistry\.get\(\1\);)')


def projects_default_view(text):
    if PD_MARK in text:
        return text
    restore, order = list(PD_RESTORE.finditer(text)), list(PD_ORDER.finditer(text))
    key = restore and "workbench.sidebar.activeviewletid" in text[max(0, restore[0].start() - 3000):restore[0].start()] or \
        restore and ".activeViewletSettingsKey," in text[max(0, restore[0].start() - 3000):restore[0].start()]
    if len(restore) != 1 or len(order) != 1 or not key:
        print("::warning::VS Code's side bar start code not found as expected; the side bar opens what it remembers, and the Projects bar "
              f"isn't first (restore {len(restore)}, view container order {len(order)}, saved choice {bool(key)})")
        return text
    a, o = restore[0].group(1), order[0]
    edits = [(restore[0].start(), restore[0].start(), f'{PD_MARK}{a}="{PROJECTS_CONTAINER}",'),
             (o.end(), o.end(), f'{PD_MARK}{o.group(1)}==="{PROJECTS_CONTAINER}"&&({o.group(4)}=-1e3);')]
    for start, stop, new in sorted(edits, key=lambda e: e[0], reverse=True):
        text = text[:start] + new + text[stop:]
    return text


# 3. The Projects bar stays: no "Hide" for it in the activity bar's right-click menu (neither its own item nor the list of
# checkable containers; the bar's `unpin` ignores it too, for any other way in), it can't be dragged to another place (the
# composite bar's `move`, and moving a container to a side bar/panel: viewDescriptorService.moveViewContainerToLocation), and its
# view has canToggleVisibility false (it can be collapsed and reordered with the Explorer in its container: lib/projects/layout.js; views registry's addViews, after the code the two patches above put there).
# All or nothing.
PA_MARK = "/*kural-projects-fixed*/"
PA_UNPIN = re.compile(r'(?<![\w$.])unpin\(([\w$]+)\)\{(?=this\.model\.setPinned\(\1,!1\))')
PA_MOVE = re.compile(r'(?<![\w$.])move\(([\w$]+),([\w$]+),([\w$]+)\)\{(?=if\(\3!==void 0\)\{let [\w$]+=this\.model\.items\.findIndex)')
PA_LIST = re.compile(r'(getContextMenuActions\([\w$]+\)\{let [\w$]+=this\.model\.visibleItems)(\.map\()')
PA_ITEM = re.compile(r'([\w$]+)\.push\((this\.toggleCompositePinnedAction),(this\.toggleCompositeBadgeAction)\)')
PA_LOCATION = re.compile(r'moveViewContainerToLocation\(([\w$]+),([\w$]+),([\w$]+),([\w$]+)\)\{(?=this\.canMoveViews\(\)&&\()')


def projects_always_shown(text):
    if PA_MARK in text:
        return text
    unpin, move, lst, item, loc = (list(r.finditer(text)) for r in (PA_UNPIN, PA_MOVE, PA_LIST, PA_ITEM, PA_LOCATION))
    adds = []
    for m in PT_ADD_VIEWS.finditer(text):
        nxt = re.compile(r'let [\w$]+=this\._views\.get\(' + re.escape(m.group(2)) + r'\);').search(text, m.end(), m.end() + 6000)
        # (only Kural's own marked code may sit between: the other patches' views code)
        if nxt and (nxt.start() == m.end() or text.startswith("/*kural-", m.end())):
            adds.append((m, nxt))
    found = {"unpin": len(unpin) == 1, "move": len(move) == 1, "container list": len(lst) == 1, "container item": len(item) == 1,
             "move to a location": len(loc) == 1, "addViews": len(adds) == 1}
    if not all(found.values()):
        print("::warning::VS Code's activity bar code not found as expected; the Projects bar can be hidden and moved ("
              + ", ".join(f"{k} {'ok' if v else 'missing'}" for k, v in found.items()) + ")")
        return text
    pid = json.dumps(PROJECTS_CONTAINER)
    views = adds[0][0].group(1)
    # (order -1: above the Explorer's views in Projects' container. Kural's own order was 1, like the file view's, and VS Code
    # breaks that tie by which view was added first: after the first start the Explorer's moved views come first.)
    view_code = (f'{PA_MARK}try{{for(const _kv of {views})try{{if(_kv&&_kv.id==={json.dumps(PROJECTS_VIEW)}){{_kv.canToggleVisibility=!1;_kv.order=-1}}}}catch{{}}}}catch{{}}')
    edits = [
        (unpin[0].end(), unpin[0].end(), f'{PA_MARK}if({unpin[0].group(1)}==={pid})return;'),
        (move[0].end(), move[0].end(), f'{PA_MARK}if({move[0].group(1)}==={pid}||{move[0].group(2)}==={pid})return!1;'),
        (loc[0].end(), loc[0].end(), f'{PA_MARK}if({loc[0].group(1)}&&{loc[0].group(1)}.id==={pid})return;'),
        (lst[0].start(2), lst[0].start(2), f'.filter(({{id:_kk}})=>_kk!=={pid})'),
        (item[0].start(), item[0].end(), f'{item[0].group(1)}.push(...(this.compositeBarActionItem&&this.compositeBarActionItem.id==={pid}?'
                                          f'[{item[0].group(3)}]:[{item[0].group(2)},{item[0].group(3)}]))'),
        (adds[0][1].start(), adds[0][1].start(), view_code),
    ]
    for start, stop, new in sorted(edits, key=lambda e: e[0], reverse=True):
        text = text[:start] + new + text[stop:]
    return text


# 4. A small card in the window's bottom right corner, above the status bar (the Projects bar's "finished / needs you" hint when
# the window has the focus but the chat isn't on screen; the system toast is for when you're away). Two commands, added at the
# end of the file like _kural.osToast (the command registry and the file's end are found the same way):
#   executeCommand("_kural.card", {id?, title, body?, button?, color?, letter?, timeout?}) -> {clicked, supported: true}
#     a rounded square in `color` with `letter`, the bold title, a grey body line, one button, a close cross. Stays `timeout` ms
#     (12000 by default; paused while the mouse is over it, and at least 1.5 s after it leaves). The button resolves clicked:
#     true; the cross, the timeout and a clear resolve clicked: false. The same id replaces the card before it. Colours come from
#     the theme's CSS variables. Only textContent and style properties are set (never innerHTML), so the strings can be anything.
#   executeCommand("_kural.cardClear", {id?}) removes one card (no id: all) -> how many.
# A miss -> ::warning::, and the extension falls back to showInformationMessage (the command isn't there).
CARD_MARK = "/*kural-card*/"
_CARD_JS = r"""
(R=>{
const K=new Map;
let box=null;
const mk=(d,tag,css,text)=>{const e=d.createElement(tag);if(css)e.style.cssText=css;if(text!=null)e.textContent=text;return e};
const area=d=>{if(!box||!box.isConnected){box=mk(d,"div","position:fixed;right:12px;bottom:34px;z-index:2600;display:flex;flex-direction:column-reverse;gap:8px;max-width:calc(100vw - 24px);pointer-events:none");box.className="kural-cards";d.body.appendChild(box)}return box};
R.registerCommand("_kural.card",(a,o)=>{
o=o||{};
const d=globalThis.document;
if(!d||!d.body)return Promise.resolve({clicked:!1,supported:!1});
const id=typeof o.id=="string"&&o.id?o.id:"#"+Math.random();
const old=K.get(id);
if(old)old(!1);
return new Promise(res=>{
const card=mk(d,"div","pointer-events:auto;box-sizing:border-box;width:340px;max-width:100%;display:flex;align-items:center;gap:10px;padding:10px 8px 10px 10px;border-radius:8px;font-family:var(--vscode-font-family,sans-serif);font-size:13px;line-height:1.35;background:var(--vscode-notifications-background,#252526);color:var(--vscode-notifications-foreground,#cccccc);border:1px solid var(--vscode-notifications-border,var(--vscode-widget-border,transparent));box-shadow:0 2px 12px var(--vscode-widget-shadow,rgba(0,0,0,.4))");
card.setAttribute("role","status");
const letter=[...String(o.letter==null?"":o.letter).trim()][0]||"";
const badge=mk(d,"div","flex:none;width:34px;height:34px;border-radius:8px;display:flex;align-items:center;justify-content:center;background:var(--vscode-button-background,#0e639c);color:#ffffff;font-weight:700;font-size:16px;user-select:none",letter.toUpperCase());
if(o.color)badge.style.background=String(o.color);
const text=mk(d,"div","flex:1;min-width:0;display:flex;flex-direction:column;gap:2px");
text.append(mk(d,"div","font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap",String(o.title==null?"Kural":o.title)));
if(o.body)text.append(mk(d,"div","color:var(--vscode-descriptionForeground,#9d9d9d);overflow:hidden;text-overflow:ellipsis;white-space:nowrap",String(o.body)));
card.append(badge,text);
const ms=Number(o.timeout);
let left=ms>0?ms:12000,t0=0,timer=0,over=!1,ended=!1;
const done=clicked=>{if(ended)return;ended=!0;clearTimeout(timer);card.remove();if(K.get(id)===done)K.delete(id);res({clicked,supported:!0})};
const arm=()=>{if(ended||over)return;t0=Date.now();timer=setTimeout(()=>done(!1),Math.max(left,0))};
if(o.button){
const b=mk(d,"button","flex:none;border:0;border-radius:4px;padding:5px 12px;cursor:pointer;background:var(--vscode-button-background,#0e639c);color:var(--vscode-button-foreground,#ffffff);font:inherit;font-size:12px",String(o.button));
b.addEventListener("mouseenter",()=>{b.style.background="var(--vscode-button-hoverBackground,#1177bb)"});
b.addEventListener("mouseleave",()=>{b.style.background="var(--vscode-button-background,#0e639c)"});
b.addEventListener("click",()=>done(!0));
card.append(b);
}
const x=mk(d,"button","flex:none;border:0;border-radius:4px;padding:2px 6px;cursor:pointer;background:transparent;color:var(--vscode-icon-foreground,var(--vscode-notifications-foreground,#cccccc));font-size:16px;line-height:1;opacity:.8","×");
x.setAttribute("aria-label","Close");
x.addEventListener("click",()=>done(!1));
card.append(x);
card.addEventListener("mouseenter",()=>{if(ended||over)return;over=!0;clearTimeout(timer);left-=Date.now()-t0});
card.addEventListener("mouseleave",()=>{if(ended||!over)return;over=!1;left=Math.max(left,1500);arm()});
K.set(id,done);
area(d).appendChild(card);
arm();
});
});
R.registerCommand("_kural.cardClear",(a,o)=>{const ids=o&&o.id?[o.id]:[...K.keys()];let n=0;for(const i of ids){const f=K.get(i);if(f){f(!1);n++}}return n});
})
"""
# (One line per statement above: joined without newlines, so a line that ends in "{" or ";" needs nothing else.)
CARD_CODE = CARD_MARK + "".join(line.strip() for line in _CARD_JS.strip().splitlines())


def add_in_window_card(text):
    if CARD_MARK in text:
        return text
    commands, end = TOAST_COMMANDS.findall(text), list(TOAST_END.finditer(text))
    if len(commands) != 1 or len(end) != 1:
        print("::warning::VS Code's command registry not found as expected; Kural's in-window cards fall back to plain messages "
              f"(command registry {len(commands)}, end {len(end)})")
        return text
    return text[:end[0].start() + 1] + CARD_CODE + f"({commands[0]});" + text[end[0].start() + 1:]


# VS Code 1.140's speech-to-text (dictation) service asks for a GitHub login as soon as it's created, at EVERY start
# (`getSessions("github", [], {silent: true})`: "silent" still wakes the GitHub login extension, which reads its saved
# login from the keychain: "Kural wants to use ... Kural Safe Storage" on a Mac, again after every update). Kural has no
# dictation, so the constructor's own first call is dropped; the service still looks again when the GitHub provider
# registers or its sessions change (something else woke it: then there is nothing new to ask).
SPEECH_PROBE_MARK = "/*kural-no-github-probe*/"
SPEECH_PROBE = re.compile(r'(this\._updateConfiguredContextKey\(\),)this\._refreshGitHubSession\(\),'
                          r'(?=this\._register\(this\._authenticationService\.onDidChangeSessions\()')


def skip_github_probe(text):
    if SPEECH_PROBE_MARK in text:
        return text
    found = SPEECH_PROBE.findall(text)
    if len(found) != 1:
        print(f"::warning::VS Code's dictation service not found as expected ({len(found)} matches); it may ask the keychain for a "
              "GitHub login at every start (a Mac's 'Kural Safe Storage' prompt)")
        return text
    return SPEECH_PROBE.sub(lambda m: SPEECH_PROBE_MARK + m.group(1), text, count=1)


# The terminal's suggestion list matches only from the start (Adithya, issue #106: "ori" showed ./.dockerignore and
# ./.python-version, d-o-cke-r-i-gnore). VS Code's terminal completion model (SimpleCompletionModel) scores items with
# firstMatchCanBeWeak: the typed letters may be anywhere in the name. An item now stays only if its name starts with what
# you typed (case doesn't matter; a leading "./" or ".\" is skipped, so "do" still finds ./docs/); the score and the
# highlight are VS Code's own. The same scorer call is in the editor's suggest model, so it's found after the terminal
# model's constructor (the only one that sets firstMatchCanBeWeak:!0 and then this._options={}). Kural's own whole-line
# items start with what you typed, or replace nothing (lib/tab/terminal.js suggestionItem), so they always stay.
TERMINAL_PREFIX_MARK = "/*kural-prefix*/"
TERMINAL_MODEL = re.compile(r'this\._fuzzyScoreOptions=\{\.\.\.[\w$]+\.default,firstMatchCanBeWeak:!0\};this\._options=\{\}\}')
TERMINAL_SCORE = re.compile(r'let ([\w$]+)=([\w$]+)\(([\w$]+),([\w$]+),([\w$]+),([\w$]+)\.textLabel,\6\.labelLow,0,this\._fuzzyScoreOptions\);')


def terminal_suggest_prefix(text):
    if TERMINAL_PREFIX_MARK in text:
        return text
    models = list(TERMINAL_MODEL.finditer(text))
    call = TERMINAL_SCORE.search(text, models[0].end(), models[0].end() + 4000) if len(models) == 1 else None
    if not call:
        print(f"::warning::the terminal's suggestion list not found as expected ({len(models)} models); it keeps matching letters "
              "anywhere in a name")
        return text
    _, _, _, low, pos, item = call.groups()
    gate = (f'if({low}.length>{pos}&&!{TERMINAL_PREFIX_MARK}((h,w)=>h.startsWith(w)||/^\\.[\\\\/]/.test(h)&&h.slice(2).startsWith(w))'
            f'({item}.labelLow,{low}.slice({pos})))continue;')
    return text[:call.start()] + gate + text[call.start():]


# Kural's browser keeps nothing (Adithya, 18 Oct 2026): no cookies, logins, cache or site data on disk, a fresh browser every
# time Kural starts. VS Code saves them by default (workbench.browser.dataStorage "default" = "global" = the partition
# "persist:vscode-browser"), and on a Mac Chromium encrypts saved cookies with the "Kural Safe Storage" keychain item, which
# asked for the keychain again after every update. Every browser tab, the AI's too (vscode.window.openBrowserTab), gets
# its storage from the workbench's _resolveStorageScope(): it now always says "ephemeral" (kept in memory, for that
# window, until it closes). package.json sets the setting to "ephemeral" as well, so a miss here still starts fresh.
FRESH_BROWSER_MARK = "/*kural-fresh-browser*/"
FRESH_BROWSER = re.compile(r'async _resolveStorageScope\(\)\{(?=let \w+=this\.configurationService\.getValue\("workbench\.browser\.dataStorage"\))')


def fresh_browser(text):
    if FRESH_BROWSER_MARK in text:
        return text
    found = FRESH_BROWSER.findall(text)
    if len(found) != 1:
        print(f"::warning::the browser's storage choice not found as expected ({len(found)} matches); Kural's browser keeps its data "
              "only as the setting workbench.browser.dataStorage says")
        return text
    return FRESH_BROWSER.sub(lambda m: m.group(0) + FRESH_BROWSER_MARK + 'return"ephemeral";', text, count=1)


# Voice input (lib/voice, media/voice.js) records in Kural's chat page, a webview. VS Code blocks the microphone there in
# three places, all patched here, found by shape (a miss: ::warning::, and the mic says the microphone was blocked):
#   1. workbench.desktop.main.js: each webview's outer frame gets an `allow` list without "microphone". Kural's own
#      webviews (extension kural.kural) get it; every other extension's webview stays without (webview_microphone).
#   2. webview/browser/pre/index.html: the inner frame's `allow` list may pass "microphone" on. Safe for every webview: a
#      frame can only pass on what its parent frame has (1). Its inline script is pinned by a sha256 in the page's own
#      CSP, so the hash is computed again (patch_webview_pre).
#   3. out/mainImpl.js: the main process answers vscode-webview:// pages' permission requests from a short list without
#      "media". It now also allows "media" when only audio is asked for: never the camera (patch_main_permissions).
WEBVIEW_MIC_MARK = "/*kural-mic*/"
WEBVIEW_ALLOW = re.compile(r'(_createElement\(\w+,\w+\)\{.{0,500}?let (\w+)=\["cross-origin-isolated","autoplay","local-network-access"\];)')


def webview_microphone(text):
    if WEBVIEW_MIC_MARK in text:
        return text
    found = WEBVIEW_ALLOW.findall(text)
    if len(found) != 1:
        print(f"::warning::the webview frame's allow list not found as expected ({len(found)} matches); voice input can't use the microphone")
        return text
    return WEBVIEW_ALLOW.sub(lambda m: m.group(1) + WEBVIEW_MIC_MARK +
                             f'this.extension?.id?.value?.toLowerCase()==="kural.kural"&&{m.group(2)}.push("microphone");', text, count=1)


PRE_ALLOW = "const allowRules = ['cross-origin-isolated;', 'autoplay;', 'local-network-access;'];"
PRE_ALLOW_MIC = "const allowRules = ['cross-origin-isolated;', 'autoplay;', 'local-network-access;', 'microphone;']; /* kural-mic: only Kural's own frames have it to pass on */"
INLINE_SCRIPT = re.compile(r'<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>', re.S)
CSP_SCRIPT_HASH = re.compile(r"(script-src ')sha256-[A-Za-z0-9+/=]+(')")


def patch_webview_pre_text(text):
    if PRE_ALLOW_MIC not in text:
        if text.count(PRE_ALLOW) != 1:
            print("::warning::the webview's inner frame allow list not found as expected; voice input can't use the microphone")
            return text
        text = text.replace(PRE_ALLOW, PRE_ALLOW_MIC)
    scripts = INLINE_SCRIPT.findall(text)
    if len(scripts) != 1 or len(CSP_SCRIPT_HASH.findall(text)) != 1:
        print(f"::warning::the webview page's script or its CSP hash not found as expected ({len(scripts)} scripts); webviews may break")
        return text
    digest = "sha256-" + base64.b64encode(hashlib.sha256(scripts[0].encode("utf-8")).digest()).decode()
    return CSP_SCRIPT_HASH.sub(lambda m: m.group(1) + digest + m.group(2), text, count=1)


MAIN_REQUEST = re.compile(r'(setPermissionRequestHandler\(\((\w+),(\w+),(\w+),(\w+)\)=>\w+\(\5\.requestingUrl\)\?\4\()(\w+\.has\(\3\))(\))')
MAIN_CHECK = re.compile(r'(setPermissionCheckHandler\(\((\w+),(\w+),(\w+),(\w+)\)=>\w+\(\5\.requestingUrl\)\?)(\w+\.has\(\3\))(:)')


def patch_main_permissions_text(text):
    if WEBVIEW_MIC_MARK in text:
        return text
    req, chk = MAIN_REQUEST.findall(text), MAIN_CHECK.findall(text)
    if len(req) != 1 or len(chk) != 1:
        print(f"::warning::the main process's webview permissions not found as expected ({len(req)}, {len(chk)} matches); voice input "
              "can't use the microphone")
        return text
    text = MAIN_REQUEST.sub(lambda m: f'{m.group(1)}{m.group(6)}||{WEBVIEW_MIC_MARK}{m.group(3)}==="media"&&'
                            f'({m.group(5)}.mediaTypes||[]).length>0&&{m.group(5)}.mediaTypes.every(k=>k==="audio"){m.group(7)}', text, count=1)
    return MAIN_CHECK.sub(lambda m: f'{m.group(1)}({m.group(6)}||{WEBVIEW_MIC_MARK}{m.group(3)}==="media"&&{m.group(5)}.mediaType==="audio"){m.group(7)}',
                          text, count=1)


def patch_webview_microphone(app):
    for rel, fn in (("out/vs/workbench/contrib/webview/browser/pre/index.html", patch_webview_pre_text),
                    ("out/mainImpl.js", patch_main_permissions_text)):
        p = os.path.join(app, *rel.split("/"))
        if not os.path.exists(p):
            print(f"::warning::{rel} not found; voice input can't use the microphone")
            continue
        with open(p, encoding="utf-8") as f:
            text = f.read()
        new = fn(text)
        if new != text:
            with open(p, "w", encoding="utf-8") as f:
                f.write(new)


# Ctrl+K's question box (extension/lib/edit/inline-ask.js) is a comment thread, and VS Code gives every comment input at
# least 5 lines (90 px; Adithya, 23 Oct 2026: "why such a huge block, keep it small"). Kural's box (contextValue
# "kural-edit") starts at 2 lines and grows as you type, up to VS Code's own maximum; every other comment box is unchanged.
# Three parts: the reply area's first height (this._editorHeight=<90>, where this._commentThread is already set), the
# size rule every comment input uses (its parent widget's commentThread), and VS Code's CSS: review.css gives every comment
# input min-height: 90px, so the box still looked 5 lines tall with its editor laid out at 2 (seen in the built app,
# 27 Oct 2026). The reply area marks the thread's body (its container, `t`) "kural-edit-box" and adds one stylesheet per
# window that lifts that minimum there, more specific than review.css's rule (4 classes).
SMALL_BOX_MARK = "/*kural-small-box*/"
SMALL_BOX_CSS = ".review-widget .body.kural-edit-box .comment-form-container .monaco-editor{min-height:0}"


# Is this thread Kural's? Its contextValue says so, but VS Code's extension host sends a new thread at once and its
# contextValue ~100 ms later (eventuallyUpdateCommentThread is debounced): the box was sized before that and stayed 5 lines
# tall until you typed (Adithya, 27 Oct 2026). The thread's id comes with it: "<controller id>.<n>", the controller being
# Kural's "kural.inlineEdit" (extension/lib/edit/inline-ask.js).
def kural_edit_thread(thread):
    return f'({thread}?.contextValue==="kural-edit"||String({thread}?.threadId||"").startsWith("kural.inlineEdit."))'


COMMENT_HEIGHTS = re.compile(r'([\w$]+)=90,([\w$]+)=450,[\w$]+=class extends [\w$]+\{constructor\(')
COMMENT_SIZE_RULE = r'(function [\w$]+\(([\w$]+),([\w$]+),([\w$]+)\)\{)(let [\w$]+=\3\.getLayoutInfo\(\),[\w$]+=\3\.getOption\((\d+)\),.{0,300}?return \4\})'
COMMENT_FIRST_HEIGHT = r'this\._editorHeight={MIN};this\._container=([\w$]+)\(([\w$]+),'


def small_edit_box(text):
    if SMALL_BOX_MARK in text:
        return text
    heights = COMMENT_HEIGHTS.findall(text)
    if len(heights) != 1:
        print(f"::warning::the comment input's height not found as expected ({len(heights)} matches); Ctrl+K's box stays 5 lines tall")
        return text
    low = heights[0][0]
    rule = re.compile(COMMENT_SIZE_RULE)
    rules = [m for m in rule.finditer(text) if re.search(rf'[^\w$]{re.escape(low)}[^\w$]', m.group(5))]
    first = re.compile(COMMENT_FIRST_HEIGHT.format(MIN=re.escape(low)))
    firsts = first.findall(text)
    if len(rules) != 1 or len(firsts) != 1:
        print(f"::warning::the comment input's size rule not found as expected ({len(rules)}, {len(firsts)} matches); Ctrl+K's box "
              "stays 5 lines tall")
        return text
    m = rules[0]
    editor, option = m.group(3), m.group(6)
    body = re.sub(rf'(?<![\w$]){re.escape(low)}(?![\w$])', "__kmin", m.group(5))
    pick = (f'let __kmin={SMALL_BOX_MARK}{kural_edit_thread(editor + "._parentThread?.commentThread")}'
            f'?2*{editor}.getOption({option}):{low};')
    text = text[:m.start()] + m.group(1) + pick + body + text[m.end():]
    def mark(fm):   # (the container: the thread's body element, the reply area's second constructor argument)
        box = fm.group(2)
        css = (f'try{{{box}.classList.add("kural-edit-box");const d={box}.ownerDocument;if(!d.getElementById("kural-edit-box-css"))'
               f'{{const s=d.createElement("style");s.id="kural-edit-box-css";s.textContent={json.dumps(SMALL_BOX_CSS)};d.head.append(s)}}}}catch{{}}')
        return (f'this._editorHeight={kural_edit_thread("this._commentThread")}?(()=>{{{css}return 36}})():{low};'
                f'this._container={fm.group(1)}({box},')
    return first.sub(mark, text, count=1)


# Design Mode's button in the browser bar (Adithya, 28 Oct 2026: "a button just like the inspect button", like Cursor's).
# VS Code draws that bar from its own menus (MenuId.BrowserActionsToolbar), which an extension's package.json can't add to.
# One menu item goes in just before the inspect button's statement (the "Add to Chat" split button, order 1): Kural's command
# kural.browser.designMode (extension/lib/browser/design-host.js), the pencil icon, shown pressed while the context key
# kural.designMode is set (Design Mode on in the tab in front). The minified names come from that statement (the menu
# registry, MenuId, Codicon, its group) and ContextKeyExpr from the code just before it. Both builds (VSCodium's download and
# the build from source) have the same shape; a miss gives a ::warning:: and the command and Cmd/Ctrl+Shift+D still work.
DESIGN_MARK = "/*kural-design-button*/"
DESIGN_ANCHOR = re.compile(r'([\w$]+)\.appendMenuItem\(([\w$]+)\.BrowserActionsToolbar,\{submenu:\2\.BrowserChatActionsMenu,'
                           r'title:[\w$]+\(\d+,"Add to Chat"\),icon:([\w$]+)\.inspect,group:("[^"]*"|[\w$.]+),order:1,')
DESIGN_CKE = re.compile(r'(?:when|precondition):([\w$]+)\.and\(')


def add_design_mode_button(text):
    if DESIGN_MARK in text:
        return text
    found = list(DESIGN_ANCHOR.finditer(text))
    if len(found) != 1:
        print(f"::warning::the browser bar's inspect button not found as expected ({len(found)} matches); no Design Mode button "
              "(Cmd/Ctrl+Shift+D and Kural: Toggle Design Mode still work)")
        return text
    m = found[0]
    near = DESIGN_CKE.findall(text[max(0, m.start() - 6000):m.start()])
    if not near:
        print("::warning::ContextKeyExpr not found near the browser bar's inspect button; no Design Mode button")
        return text
    registry, menu, codicon, group = m.groups()
    item = (f'{DESIGN_MARK}{registry}.appendMenuItem({menu}.BrowserActionsToolbar,{{command:{{id:"kural.browser.designMode",'
            f'title:"Design Mode",icon:{codicon}.edit,toggled:{near[-1]}.equals("kural.designMode",!0)}},group:{group},order:0}});')
    return text[:m.start()] + item + text[m.start():]


# The side bar stays when the chat is maximized (Adithya, 27 Oct 2026: "when Kural goes full screen, Projects also minimizes").
# The chat panel's Maximize button is VS Code's "maximize the secondary side bar" (layoutService.setAuxiliaryBarMaximized),
# which hides the editor, the bottom panel AND the primary side bar. Only the side bar's line is taken out: Projects, the
# Explorer and the activity bar stay; the editor and panel still make room. Maximized is a remembered flag
# (AUXILIARYBAR_WAS_LAST_MAXIMIZED), not "the side bar is hidden", so the button and its toggle keep working; un-maximizing
# shows again what was visible before, the side bar included.
MAXIMIZE_SIDEBAR_MARK = "/*kural-keep-sidebar*/"
MAXIMIZE_HIDES_SIDEBAR = re.compile(r'(setAuxiliaryBarMaximized\([\w$]+\)\{.{0,700}?)([\w$]+)\.sideBarVisible&&this\.setSideBarHidden\(!0\),')


def keep_sidebar_when_maximized(text):
    if MAXIMIZE_SIDEBAR_MARK in text:
        return text
    found = MAXIMIZE_HIDES_SIDEBAR.findall(text)
    if len(found) != 1:
        print(f"::warning::the secondary side bar's maximize not found as expected ({len(found)} matches); maximizing the chat "
              "still hides Projects and the Explorer")
        return text
    return MAXIMIZE_HIDES_SIDEBAR.sub(lambda m: m.group(1) + MAXIMIZE_SIDEBAR_MARK, text, count=1)


# A build from source (scripts/vscode/build.sh) applies Kural's own patches to VS Code's TypeScript (patches/kural/NNNN-name.patch)
# and writes product.json "kuralSource": {"commit": ..., "patches": ["0200-drop-explorer-empty-view", ...]}. The Projects bar's four
# patches below exist in both forms; a name in that list means the source patch is already in the app, so the function is skipped.
# Without kuralSource (VSCodium's download, as always) nothing is skipped. The order is the order they run in.
PROJECTS_SOURCE_PATCHES = [
    ("0200-drop-explorer-empty-view", drop_explorer_empty_view),
    ("0201-projects-default-view", projects_default_view),
    ("0202-projects-always-shown", projects_always_shown),
    ("0203-in-window-card", add_in_window_card),
]


def built_in_patches(product):
    """The source patches this app was built with (product.json kuralSource.patches), as a set of names."""
    source = product.get("kuralSource")
    names = source.get("patches") if isinstance(source, dict) else None
    return {n for n in names if isinstance(n, str)} if isinstance(names, list) else set()


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
    new = add_design_mode_button(keep_sidebar_when_maximized(small_edit_box(terminal_suggest_prefix(webview_microphone(fresh_browser(skip_github_probe(add_workspace_color_item(add_plugins_tab(hide_debug_views(add_os_toast(route_browser_to_kural(hide_builtin_views(add_update_menu(drop_vscodium_welcome(text)))))))))))))))
    # (The Projects bar's four: after the views patches above, whose code at the start of addViews one of them looks for.
    # A build from source has them as patches/kural/*.patch and lists them in product.json's kuralSource: not done twice.)
    built = built_in_patches(product)
    for source_patch, fn in PROJECTS_SOURCE_PATCHES:
        if source_patch in built:
            print(f"{fn.__name__}: built in ({source_patch}), skipped")
        else:
            new = fn(new)
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


def version_label():
    """Same words as extension/lib/version.js: "v1.1.0-rc.1", or "Unreleased version · main (abc1234)" for a build
    from the code (install.sh writes extension/build.json; release builds never have it)."""
    ext = os.path.join(ROOT, "extension")
    version = load(os.path.join(ext, "package.json")).get("version", "")
    try:
        b = load(os.path.join(ext, "build.json"))
    except (OSError, ValueError):
        b = None
    if not b or b.get("release"):
        return f"v{version}"
    commit = f" ({b['commit']})" if b.get("commit") else ""
    return f"Unreleased version \u00b7 {b.get('branch') or 'local'}{commit}"


# The Extensions side bar's title, "Extensions & Plugins" once it has the Plugins tab (add_plugins_tab): its message's
# number is read from the side bar's registration (`title:O(16887,"Extensions")`: message 16887 of nls.messages.json).
EXT_TITLE = re.compile(r'registerViewContainer\(\{id:[\w$]+,title:[\w$]+\((\d+),"Extensions"\),openCommandActionDescriptor:')
EXT_TITLE_NEW = "Extensions & Plugins"


def extensions_title_index(app):
    """The number of the Extensions side bar's title message, when the workbench has the Plugins tab; else None."""
    try:
        with open(os.path.join(app, "out", "vs", "workbench", "workbench.desktop.main.js"), encoding="utf-8") as f:
            text = f.read()
    except OSError:
        return None
    found = EXT_TITLE.findall(text)
    if PT_MARK not in text or len(found) != 1:
        return None
    return int(found[0])


def rebrand_messages(app):
    p = os.path.join(app, "out", "nls.messages.json")
    if not os.path.exists(p):
        print("::warning::out/nls.messages.json not found; the editor's texts keep saying VSCodium")
        return
    messages = load(p)
    if not isinstance(messages, list):
        print("::warning::out/nls.messages.json looks different; the editor's texts keep saying VSCodium")
        return
    title = extensions_title_index(app)
    def kural(m):
        for wiki in GUIDANCE_WIKIS:
            m = m.replace(wiki, f"{REPO}/blob/main/CONTRIBUTING.md")
        if m == "Editing evolved":   # the Welcome page's line under "Kural Code Editor": says which version this is
            return f"{m} \u00b7 {version_label()}"
        return VSCODIUM_WORD.sub(TITLE, m)
    new = [kural(m) if isinstance(m, str) else m for m in messages]
    if title is not None and title < len(new) and new[title] in ("Extensions", EXT_TITLE_NEW):
        new[title] = EXT_TITLE_NEW
    elif title is not None:
        print(f"::warning::the Extensions side bar's title isn't message {title} as expected; it stays \"Extensions\"")
    if new == messages:
        return
    with open(p, "w", encoding="utf-8") as f:
        json.dump(new, f, ensure_ascii=False, separators=(",", ":"))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])

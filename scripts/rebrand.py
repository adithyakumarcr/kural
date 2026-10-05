#!/usr/bin/env python3
"""Turns an unpacked VSCodium into Kural. Shared by the Linux, macOS and Windows builds.

Usage: rebrand.py <app-dir> <linux|mac|win>
  <app-dir> is VSCodium's resources/app folder (the one containing product.json).
"""
import base64, hashlib, json, os, re, shutil, sys, uuid

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NAME, TITLE, LONG = "kural", "Kural", "Kural Code Editor"


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
    # 6. VS Code's own code: Help → Check for Updates… (Kural's updater), and VS Code's Search and Output views hidden
    #    (Kural's Search & Ask side bar does text search; Kural's log opens with "Kural: Show Log").
    patch_workbench(app)
    print(f"rebranded {app} for {platform}")


# Kural changes two things in VS Code's own code (workbench.desktop.main.js):
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
    new = hide_builtin_views(add_update_menu(text))
    if new == text:
        return
    data = new.encode("utf-8")
    with open(js_path, "wb") as f:
        f.write(data)
    sums[rel] = fingerprint(data)
    save(pj_path, product)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])

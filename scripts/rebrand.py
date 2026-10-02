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
    save(p, d)

    # 2. The window/dock name on Linux ("codium" otherwise).
    pkg = os.path.join(app, "package.json")
    d = load(pkg)
    d["desktopName"] = f"{NAME}.desktop"
    save(pkg, d)

    # 3. Built-in extensions: Kural + Claudemeter.
    ext = os.path.join(app, "extensions")
    for src, dst in (("extension", NAME), (os.path.join("vendor", "claudemeter"), "claudemeter")):
        target = os.path.join(ext, dst)
        shutil.rmtree(target, ignore_errors=True)
        shutil.copytree(os.path.join(ROOT, src), target, ignore=shutil.ignore_patterns("README.md") if dst == "claudemeter" else None)
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
    # 6. Help → Check for Updates… (Kural's own updater, from GitHub releases).
    add_update_menu(app)
    print(f"rebranded {app} for {platform}")


# Extensions can't add items to the Help menu, so the item goes into VS Code's own code, next to its
# "Ask @vscode" Help item. VS Code checks that file against a fingerprint in product.json ("checksums")
# and calls the install "corrupt" if it changed, so the fingerprint is updated too. If VS Code's code
# looks different (another VSCodium version), the menu item is skipped; the command palette still has it.
HELP_ITEM = re.compile(r'(\w+)\.appendMenuItem\((\w+)\.MenubarHelpMenu,\{command:\{id:\w+\.ID,title:\w+\(\d+,"Ask @vscode"\)')


def fingerprint(data):
    return base64.b64encode(hashlib.sha256(data).digest()).decode().rstrip("=")


def add_update_menu(app):
    rel = "vs/workbench/workbench.desktop.main.js"
    js_path, pj_path = os.path.join(app, "out", rel), os.path.join(app, "product.json")
    with open(js_path, "rb") as f:
        data = f.read()
    product = load(pj_path)
    sums = product.get("checksums", {})
    if b"kural.checkForUpdates" in data:
        return
    if sums.get(rel) != fingerprint(data):
        print("warning: unexpected workbench fingerprint; Help → Check for Updates not added")
        return
    text = data.decode("utf-8")
    m = HELP_ITEM.search(text)
    if not m:
        print("warning: Help menu code not found; Help → Check for Updates not added")
        return
    registry, ids = m.group(1), m.group(2)
    item = (f'{registry}.appendMenuItem({ids}.MenubarHelpMenu,{{command:{{id:"kural.checkForUpdates",'
            f'title:"Check for Updates..."}},group:"7_update",order:1}}),')
    data = (text[:m.start()] + item + text[m.start():]).encode("utf-8")
    with open(js_path, "wb") as f:
        f.write(data)
    sums[rel] = fingerprint(data)
    save(pj_path, product)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])

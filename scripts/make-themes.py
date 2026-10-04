# Writes Kural Dark and Kural Light (extension/themes/). Edit the colors here, run `python3 scripts/make-themes.py`,
# then `node test/theme.test.js` (contrast). The code colors are VS Code's Dark+ / Light+ (many colors, easy to read);
# the window is like VS Code's Dark Modern / Light Modern; purple, Kural's color, marks only focus and actions.
import json, os
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "extension", "themes")

def tokens(t):
    r = lambda scope, fg=None, style=None: {"scope": scope, "settings": {**({"foreground": fg} if fg else {}), **({"fontStyle": style} if style else {})}}
    return [
        r(["comment", "punctuation.definition.comment"], t["comment"], "italic"),
        r(["string", "string.quoted", "string.template", "punctuation.definition.string"], t["string"]),
        r(["constant.character.escape", "constant.character"], t["escape"]),
        r(["string.regexp"], t["regex"]),
        r(["constant.numeric", "keyword.other.unit"], t["number"]),
        r(["constant.language", "variable.language", "variable.language.this", "variable.language.self", "variable.language.super"], t["langconst"]),
        r(["constant.other", "support.constant", "variable.other.constant", "variable.other.enummember"], t["constant"]),
        r(["keyword", "storage", "storage.type", "storage.modifier", "keyword.other"], t["keyword"]),
        r(["keyword.control", "keyword.control.flow", "keyword.control.import", "keyword.control.from", "keyword.control.export", "keyword.operator.new", "keyword.operator.expression", "keyword.operator.logical.python"], t["control"]),
        r(["keyword.operator", "punctuation.separator", "punctuation.terminator", "punctuation.accessor"], t["operator"]),
        r(["entity.name.function", "support.function", "meta.function-call entity.name.function", "entity.name.method", "entity.name.decorator", "meta.decorator", "punctuation.decorator"], t["function"]),
        r(["entity.name.type", "entity.name.class", "entity.name.namespace", "support.class", "support.type", "entity.other.inherited-class", "storage.type.class.jsdoc", "entity.name.type.module"], t["type"]),
        r(["variable", "variable.parameter", "meta.parameter", "meta.definition.variable", "variable.other.readwrite"], t["variable"]),
        r(["support.type.property-name", "meta.object-literal.key", "variable.other.property", "variable.other.object.property", "support.variable.property"], t["property"]),
        r(["support.type.property-name.json"], t["jsonkey"]),
        r(["entity.name.tag", "punctuation.definition.tag"], t["tag"]),
        r(["entity.other.attribute-name"], t["attribute"]),
        r(["entity.other.attribute-name.class.css", "entity.other.attribute-name.id.css", "entity.name.tag.css"], t["cssselector"]),
        r(["support.type.property-name.css"], t["cssprop"]),
        r(["markup.heading", "entity.name.section"], t["heading"], "bold"),
        r(["markup.bold"], None, "bold"),
        r(["markup.italic"], None, "italic"),
        r(["markup.underline.link", "string.other.link"], t["link"]),
        r(["markup.inline.raw", "markup.fenced_code", "markup.raw"], t["string"]),
        r(["markup.inserted"], t["inserted"]),
        r(["markup.deleted"], t["deleted"]),
        r(["invalid"], t["invalid"]),
    ]

def semantic(t):
    return {"function": t["function"], "method": t["function"], "class": t["type"], "type": t["type"], "interface": t["type"],
            "enum": t["type"], "namespace": t["type"], "typeParameter": t["type"], "parameter": t["variable"], "variable": t["variable"],
            "property": t["property"], "enumMember": t["constant"], "variable.readonly": t["constant"], "decorator": t["function"],
            "selfParameter": {"foreground": t["langconst"], "italic": True}}

# The window: like VS Code's Dark Modern / Light Modern. Purple (Kural's color) only for what marks focus and action:
# buttons, the active tab / view / panel line, focus rings, badges, progress, links, the cursor.
def colors(c, P):
    return {
        "foreground": c["fg"], "descriptionForeground": c["desc"], "errorForeground": c["error"], "focusBorder": P["focus"],
        "selection.background": c["sel"], "widget.border": c["border"], "widget.shadow": c["shadow"], "icon.foreground": c["icon"],
        "textLink.foreground": P["link"], "textLink.activeForeground": P["linkActive"], "textCodeBlock.background": c["codeblock"],
        "textPreformat.foreground": c["preformat"], "textBlockQuote.background": c["codeblock"], "textBlockQuote.border": P["main"],
        "progressBar.background": P["main"],

        "editor.background": c["editor"], "editor.foreground": c["editorFg"],
        "editorLineNumber.foreground": c["lineNo"], "editorLineNumber.activeForeground": c["lineNoActive"],
        "editorCursor.foreground": P["cursor"],
        "editor.selectionBackground": c["sel"], "editor.inactiveSelectionBackground": c["selInactive"],
        "editor.selectionHighlightBackground": c["selHi"], "editor.wordHighlightBackground": c["wordHi"],
        "editor.wordHighlightStrongBackground": c["wordHiStrong"],
        "editor.lineHighlightBackground": "#00000000", "editor.lineHighlightBorder": c["lineHi"],
        "editor.findMatchBackground": c["find"], "editor.findMatchHighlightBackground": c["findHi"],
        "editor.rangeHighlightBackground": c["range"],
        "editorIndentGuide.background1": c["indent"], "editorIndentGuide.activeBackground1": c["indentActive"],
        "editorWhitespace.foreground": c["whitespace"], "editorRuler.foreground": c["indent"],
        "editorBracketMatch.background": c["bracketBg"], "editorBracketMatch.border": c["bracketBorder"],
        "editorBracketHighlight.foreground1": c["br1"], "editorBracketHighlight.foreground2": c["br2"], "editorBracketHighlight.foreground3": c["br3"],
        "editorGhostText.foreground": c["ghost"], "editorCodeLens.foreground": c["codelens"],
        "editorGutter.addedBackground": c["added"], "editorGutter.modifiedBackground": c["modified"], "editorGutter.deletedBackground": c["deleted"],
        "editorOverviewRuler.border": "#00000000",
        "editorError.foreground": c["error"], "editorWarning.foreground": c["warning"], "editorInfo.foreground": c["info"],
        "editorWidget.background": c["widget"], "editorWidget.border": c["border"], "editorWidget.foreground": c["fg"],
        "editorSuggestWidget.background": c["widget"], "editorSuggestWidget.border": c["border"], "editorSuggestWidget.foreground": c["editorFg"],
        "editorSuggestWidget.selectedBackground": c["listActive"], "editorSuggestWidget.selectedForeground": c["listActiveFg"],
        "editorSuggestWidget.highlightForeground": c["match"], "editorSuggestWidget.focusHighlightForeground": c["match"],
        "editorHoverWidget.background": c["widget"], "editorHoverWidget.border": c["border"],
        "editorGroup.border": c["border"], "editorGroupHeader.tabsBackground": c["chrome"], "editorGroupHeader.tabsBorder": c["border"],
        "minimap.background": c["editor"], "scrollbarSlider.background": c["slider"], "scrollbarSlider.hoverBackground": c["sliderHover"],
        "scrollbarSlider.activeBackground": c["sliderActive"],
        "diffEditor.insertedTextBackground": c["diffIns"], "diffEditor.removedTextBackground": c["diffDel"],
        "diffEditor.insertedLineBackground": c["diffInsLine"], "diffEditor.removedLineBackground": c["diffDelLine"],

        "tab.activeBackground": c["editor"], "tab.inactiveBackground": c["chrome"], "tab.activeForeground": c["fgStrong"],
        "tab.inactiveForeground": c["desc"], "tab.border": c["border"], "tab.activeBorderTop": P["main"],
        "tab.unfocusedActiveBorderTop": c["border"], "tab.hoverBackground": c["editor"], "tab.lastPinnedBorder": c["border"],

        "titleBar.activeBackground": c["chrome"], "titleBar.inactiveBackground": c["chrome"], "titleBar.activeForeground": c["fg"],
        "titleBar.inactiveForeground": c["desc"], "titleBar.border": c["border"],
        "commandCenter.background": c["input"], "commandCenter.border": c["inputBorder"], "commandCenter.foreground": c["fg"],
        "commandCenter.activeBorder": P["focus"],
        "menu.background": c["widget"], "menu.foreground": c["fg"], "menu.selectionBackground": P["main"], "menu.selectionForeground": "#ffffff",
        "menu.border": c["border"], "menu.separatorBackground": c["border"],

        "activityBar.background": c["chrome"], "activityBar.foreground": c["fgStrong"], "activityBar.inactiveForeground": c["iconInactive"],
        "activityBar.border": c["border"], "activityBar.activeBorder": P["main"], "activityBar.activeBackground": "#00000000",
        "activityBarBadge.background": P["main"], "activityBarBadge.foreground": "#ffffff",

        "sideBar.background": c["chrome"], "sideBar.foreground": c["fg"], "sideBar.border": c["border"],
        "sideBarTitle.foreground": c["fg"], "sideBarSectionHeader.background": c["chrome"], "sideBarSectionHeader.foreground": c["fg"],
        "sideBarSectionHeader.border": c["border"],
        "list.activeSelectionBackground": c["listActive"], "list.activeSelectionForeground": c["listActiveFg"],
        "list.inactiveSelectionBackground": c["listInactive"], "list.inactiveSelectionForeground": c["fg"],
        "list.hoverBackground": c["listHover"], "list.focusOutline": P["focus"], "list.focusAndSelectionOutline": P["focus"],
        "list.highlightForeground": c["match"], "tree.indentGuidesStroke": c["indentActive"],

        "panel.background": c["chrome"], "panel.border": c["border"], "panelTitle.activeBorder": P["main"],
        "panelTitle.activeForeground": c["fgStrong"], "panelTitle.inactiveForeground": c["desc"],
        "terminal.background": c["chrome"], "terminal.foreground": c["fg"], "terminalCursor.foreground": P["cursor"],
        **{f"terminal.ansi{k}": v for k, v in c["ansi"].items()},

        "statusBar.background": c["chrome"], "statusBar.foreground": c["fg"], "statusBar.border": c["border"],
        "statusBar.noFolderBackground": c["chrome"], "statusBar.focusBorder": P["focus"],
        "statusBar.debuggingBackground": P["main"], "statusBar.debuggingForeground": "#ffffff",
        "statusBarItem.hoverBackground": c["listHover"], "statusBarItem.remoteBackground": P["main"], "statusBarItem.remoteForeground": "#ffffff",
        "statusBarItem.prominentBackground": c["listActive"],

        "input.background": c["input"], "input.border": c["inputBorder"], "input.foreground": c["fg"],
        "input.placeholderForeground": c["placeholder"], "inputOption.activeBorder": P["main"], "inputOption.activeBackground": P["soft"],
        "inputOption.activeForeground": c["fgStrong"],
        "quickInput.background": c["widget"], "quickInput.foreground": c["fg"],
        "quickInputList.focusBackground": c["listActive"], "quickInputList.focusForeground": c["listActiveFg"],
        "dropdown.background": c["input"], "dropdown.border": c["inputBorder"], "dropdown.foreground": c["fg"],
        "button.background": P["main"], "button.foreground": "#ffffff", "button.hoverBackground": P["hover"], "button.border": "#00000000",
        "button.secondaryBackground": c["secondary"], "button.secondaryForeground": c["fgStrong"], "button.secondaryHoverBackground": c["secondaryHover"],
        "checkbox.background": c["input"], "checkbox.border": c["inputBorder"],
        "badge.background": P["badge"], "badge.foreground": P["badgeFg"],
        "notifications.background": c["widget"], "notifications.foreground": c["fg"], "notifications.border": c["border"],
        "notificationCenterHeader.background": c["chrome"],
        "breadcrumb.foreground": c["desc"], "breadcrumb.focusForeground": c["fgStrong"],
        "gitDecoration.modifiedResourceForeground": c["gitModified"], "gitDecoration.untrackedResourceForeground": c["gitUntracked"],
        "gitDecoration.addedResourceForeground": c["gitUntracked"], "gitDecoration.deletedResourceForeground": c["gitDeleted"],
        "gitDecoration.ignoredResourceForeground": c["iconInactive"], "gitDecoration.conflictingResourceForeground": c["gitConflict"],
        "sash.hoverBorder": P["main"],
        "keybindingLabel.background": c["secondary"], "keybindingLabel.foreground": c["fgStrong"], "keybindingLabel.border": c["inputBorder"],
        "keybindingLabel.bottomBorder": c["inputBorder"],
        "settings.headerForeground": c["fgStrong"], "settings.modifiedItemIndicator": P["main"],
        "welcomePage.tileBackground": c["widget"], "walkThrough.embeddedEditorBackground": c["codeblock"],
        "pickerGroup.foreground": P["link"], "pickerGroup.border": c["border"],
        "peekViewEditor.background": c["peek"], "peekViewResult.background": c["chrome"], "peekView.border": P["main"],
        "peekViewTitle.background": c["chrome"],
    }

DARK_P = {"main": "#7c5ce6", "hover": "#8f73ee", "focus": "#8b6cef", "link": "#a68af9", "linkActive": "#c4b0ff", "cursor": "#b39dfa",
          "soft": "#8b6cef33", "badge": "#7c5ce6", "badgeFg": "#ffffff"}
# (Red, blue and magenta a little lighter than VS Code's own, so they read on the dark panel: test/theme.test.js)
DARK = {
    "fg": "#cccccc", "fgStrong": "#ffffff", "desc": "#9d9d9d", "error": "#f85149", "sel": "#264f78", "border": "#2b2b2b", "shadow": "#0000005c",
    "icon": "#cccccc", "iconInactive": "#868686", "codeblock": "#2b2b2b", "preformat": "#d7ba7d",
    "editor": "#1f1f1f", "editorFg": "#d4d4d4", "chrome": "#181818", "lineNo": "#6e7681", "lineNoActive": "#cccccc",
    "selInactive": "#3a3d41", "selHi": "#add6ff26", "wordHi": "#575757b8", "wordHiStrong": "#004972b8", "lineHi": "#282828",
    "find": "#9e6a03", "findHi": "#ea5c0055", "range": "#ffffff0b", "indent": "#404040", "indentActive": "#707070", "whitespace": "#3b3b3b",
    "bracketBg": "#0064001a", "bracketBorder": "#888888", "br1": "#ffd700", "br2": "#da70d6", "br3": "#179fff",
    "ghost": "#8b8b8b", "codelens": "#999999", "added": "#2ea043", "modified": "#0078d4", "deleted": "#f85149",
    "warning": "#cca700", "info": "#3794ff", "widget": "#202020", "listActive": "#04395e", "listActiveFg": "#ffffff",
    "listInactive": "#37373d", "listHover": "#2a2d2e", "match": "#2aaaff", "slider": "#79797966", "sliderHover": "#646464b3",
    "sliderActive": "#bfbfbf66", "diffIns": "#9ccc2c33", "diffDel": "#ff000033", "diffInsLine": "#9bb95533", "diffDelLine": "#ff000033",
    "input": "#313131", "inputBorder": "#3c3c3c", "placeholder": "#989898", "secondary": "#313131", "secondaryHover": "#3c3c3c",
    "gitModified": "#e2c08d", "gitUntracked": "#73c991", "gitDeleted": "#c74e39", "gitConflict": "#e4676b", "peek": "#1f1f1f",
    "ansi": {"Black": "#000000", "Red": "#f14c4c", "Green": "#0dbc79", "Yellow": "#e5e510", "Blue": "#3b8eea", "Magenta": "#d670d6",
             "Cyan": "#11a8cd", "White": "#e5e5e5", "BrightBlack": "#666666", "BrightRed": "#ff7b72", "BrightGreen": "#23d18b",
             "BrightYellow": "#f5f543", "BrightBlue": "#6cb0f5", "BrightMagenta": "#e59ce5", "BrightCyan": "#29b8db", "BrightWhite": "#e5e5e5"},
}
DARK_T = {"comment": "#6a9955", "string": "#ce9178", "escape": "#d7ba7d", "regex": "#d16969", "number": "#b5cea8", "langconst": "#569cd6",
          "constant": "#4fc1ff", "keyword": "#569cd6", "control": "#c586c0", "operator": "#d4d4d4", "function": "#dcdcaa", "type": "#4ec9b0",
          "variable": "#9cdcfe", "property": "#9cdcfe", "jsonkey": "#9cdcfe", "tag": "#569cd6", "attribute": "#9cdcfe",
          "cssselector": "#d7ba7d", "cssprop": "#9cdcfe", "heading": "#569cd6", "link": "#a68af9", "inserted": "#b5cea8",
          "deleted": "#ce9178", "invalid": "#f44747"}

LIGHT_P = {"main": "#6447d6", "hover": "#5a3cc8", "focus": "#6447d6", "link": "#5a3cc8", "linkActive": "#4a2fb0", "cursor": "#6447d6",
           "soft": "#6447d624", "badge": "#e3ddfa", "badgeFg": "#3d2a8c"}
LIGHT = {
    "fg": "#3b3b3b", "fgStrong": "#1f1f1f", "desc": "#616161", "error": "#e51400", "sel": "#add6ff", "border": "#e5e5e5", "shadow": "#00000029",
    "icon": "#3b3b3b", "iconInactive": "#616161", "codeblock": "#f0f0f0", "preformat": "#a31515",
    "editor": "#ffffff", "editorFg": "#1f1f1f", "chrome": "#f8f8f8", "lineNo": "#6e7681", "lineNoActive": "#1f1f1f",
    "selInactive": "#e5ebf1", "selHi": "#add6ff80", "wordHi": "#57575740", "wordHiStrong": "#0e639c40", "lineHi": "#eeeeee",
    "find": "#a8ac94", "findHi": "#ea5c0055", "range": "#fdff0033", "indent": "#d3d3d3", "indentActive": "#939393", "whitespace": "#d3d3d3",
    "bracketBg": "#0064001a", "bracketBorder": "#b9b9b9", "br1": "#0431fa", "br2": "#319331", "br3": "#7b3814",
    "ghost": "#6e6e6e", "codelens": "#616161", "added": "#2ea043", "modified": "#005fb8", "deleted": "#f85149",
    "warning": "#bf8803", "info": "#1a85ff", "widget": "#ffffff", "listActive": "#e8e8e8", "listActiveFg": "#000000",
    "listInactive": "#e4e6f1", "listHover": "#f2f2f2", "match": "#0066bf", "slider": "#64646466", "sliderHover": "#646464b3",
    "sliderActive": "#00000099", "diffIns": "#9ccc2c40", "diffDel": "#ff000033", "diffInsLine": "#9bb95533", "diffDelLine": "#ff000033",
    "input": "#ffffff", "inputBorder": "#cecece", "placeholder": "#767676", "secondary": "#e5e5e5", "secondaryHover": "#cccccc",
    "gitModified": "#895503", "gitUntracked": "#007100", "gitDeleted": "#ad0707", "gitConflict": "#ad0707", "peek": "#f2f8fc",
    # (darker than VS Code's own, so every color reads on the light panel: test/theme.test.js)
    "ansi": {"Black": "#000000", "Red": "#c02a3a", "Green": "#2c7a34", "Yellow": "#8a5d00", "Blue": "#1d5bbf", "Magenta": "#a01eb0",
             "Cyan": "#0b7575", "White": "#616161", "BrightBlack": "#5d5a6b", "BrightRed": "#a5202f", "BrightGreen": "#226b2a",
             "BrightYellow": "#7a5200", "BrightBlue": "#174ea6", "BrightMagenta": "#8b1a9a", "BrightCyan": "#08666a", "BrightWhite": "#3b3b3b"},
}
LIGHT_T = {"comment": "#008000", "string": "#a31515", "escape": "#ee0000", "regex": "#811f3f", "number": "#098658", "langconst": "#0000ff",
           "constant": "#0070c1", "keyword": "#0000ff", "control": "#af00db", "operator": "#3b3b3b", "function": "#795e26", "type": "#267f99",
           "variable": "#001080", "property": "#001080", "jsonkey": "#0451a5", "tag": "#800000", "attribute": "#e50000",
           "cssselector": "#800000", "cssprop": "#e50000", "heading": "#800000", "link": "#5a3cc8", "inserted": "#098658",
           "deleted": "#a31515", "invalid": "#cd3131"}

for name, typ, c, P, t, fn in [("Kural Dark", "dark", DARK, DARK_P, DARK_T, "kural-dark-color-theme.json"),
                               ("Kural Light", "light", LIGHT, LIGHT_P, LIGHT_T, "kural-light-color-theme.json")]:
    theme = {"name": name, "type": typ, "semanticHighlighting": True, "colors": colors(c, P), "tokenColors": tokens(t), "semanticTokenColors": semantic(t)}
    with open(os.path.join(OUT, fn), "w") as f: json.dump(theme, f, indent=2); f.write("\n")
print("ok")

; Kural installer for Windows 10/11 (x64). Built with NSIS (makensis), which also runs on Linux.
; Installs for the current user only: no admin rights needed.
; makensis -DVERSION=3.0.0 -DSRC=<folder with Kural.exe> -DICON=<icon.ico> -DOUT=<setup.exe> kural.nsi

Unicode true
SetCompressor /SOLID lzma
RequestExecutionLevel user

!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "sign.nsh"   ; signed when a code signing certificate is set up (-DSIGN). (makensis reads from this folder)

Name "Kural Code Editor"
OutFile "${OUT}"
InstallDir "$LOCALAPPDATA\Programs\Kural"
InstallDirRegKey HKCU "Software\Kural" "InstallDir"
BrandingText "Kural ${VERSION}"

!define MUI_ICON "${ICON}"
!define MUI_UNICON "${ICON}"
!define MUI_ABORTWARNING
!define MUI_FINISHPAGE_RUN "$INSTDIR\Kural.exe"
!define MUI_FINISHPAGE_RUN_TEXT "Start Kural"

!insertmacro MUI_PAGE_WELCOME
!define MUI_PAGE_CUSTOMFUNCTION_LEAVE DirLeave
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_COMPONENTS
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

!define UNINST "Software\Microsoft\Windows\CurrentVersion\Uninstall\Kural"

; Setup and the uninstaller delete the whole install folder (RMDir /r), and that folder can be one you typed or one read
; from the registry. So it must be Kural's own: named Kural, not your user folder or a system folder, and either
; missing, empty, or holding Kural (Kural.exe or its uninstaller). Anything else is refused: a folder like C:\, your
; Documents or a project folder is never wiped. DirWhy = why not ("" = fine).
Var DirWhy
!macro KURAL_DIR_CHECK UN
Function ${UN}KuralDirCheck
  Push $0
  Push $1
  Push $2
  StrCpy $DirWhy ""
  StrCpy $0 "$INSTDIR" "" -6
  ${If} $0 != "\Kural"
    StrCpy $DirWhy "the folder must be named Kural, for example $LOCALAPPDATA\Programs\Kural"
  ${ElseIf} "$INSTDIR" == "$PROFILE"
  ${OrIf} "$INSTDIR" == "$DESKTOP"
  ${OrIf} "$INSTDIR" == "$DOCUMENTS"
  ${OrIf} "$INSTDIR" == "$APPDATA"
  ${OrIf} "$INSTDIR" == "$LOCALAPPDATA"
  ${OrIf} "$INSTDIR" == "$WINDIR"
  ${OrIf} "$INSTDIR" == "$TEMP"
    StrCpy $DirWhy "that's a Windows or user folder"
  ${ElseIf} ${FileExists} "$INSTDIR\*.*"
  ${AndIfNot} ${FileExists} "$INSTDIR\Kural.exe"
  ${AndIfNot} ${FileExists} "$INSTDIR\Uninstall Kural.exe"
    ; It exists but holds no Kural: fine only when it's empty.
    FindFirst $1 $0 "$INSTDIR\*.*"
    ${DoWhile} $0 != ""
      ${If} $0 != "."
      ${AndIf} $0 != ".."
        StrCpy $DirWhy "the folder already has other files in it; choose an empty folder"
        ${Break}
      ${EndIf}
      FindNext $1 $0
    ${Loop}
    FindClose $1
  ${EndIf}
  Pop $2
  Pop $1
  Pop $0
FunctionEnd
!macroend
!insertmacro KURAL_DIR_CHECK ""
!insertmacro KURAL_DIR_CHECK "un."

; The folder page: say why and stay on the page.
Function DirLeave
  Call KuralDirCheck
  ${If} $DirWhy != ""
    MessageBox MB_ICONEXCLAMATION|MB_OK "Kural can't be installed in $INSTDIR: $DirWhy."
    Abort
  ${EndIf}
FunctionEnd

Section "Kural (required)" SecMain
  SectionIn RO
  ; An older Kural in this folder is replaced (your settings live elsewhere and are kept). Checked again here: a silent
  ; install (/S, the in-app updater) skips the folder page.
  Call KuralDirCheck
  ${If} $DirWhy != ""
    MessageBox MB_ICONSTOP|MB_OK "Kural can't be installed in $INSTDIR: $DirWhy." /SD IDOK
    SetErrorLevel 2
    Abort
  ${EndIf}
  RMDir /r "$INSTDIR"
  SetOutPath "$INSTDIR"
  File /r "${SRC}\*.*"
  WriteUninstaller "$INSTDIR\Uninstall Kural.exe"

  WriteRegStr HKCU "Software\Kural" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "${UNINST}" "DisplayName" "Kural"
  WriteRegStr HKCU "${UNINST}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINST}" "Publisher" "Adithya Chinnakkonda"
  WriteRegStr HKCU "${UNINST}" "DisplayIcon" "$INSTDIR\Kural.exe"
  WriteRegStr HKCU "${UNINST}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINST}" "UninstallString" '"$INSTDIR\Uninstall Kural.exe"'
  WriteRegDWORD HKCU "${UNINST}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINST}" "NoRepair" 1

  CreateShortcut "$SMPROGRAMS\Kural.lnk" "$INSTDIR\Kural.exe"
SectionEnd

Section "Desktop shortcut" SecDesktop
  CreateShortcut "$DESKTOP\Kural.lnk" "$INSTDIR\Kural.exe"
SectionEnd

Section "Add 'Open with Kural' to the right-click menu" SecContext
  WriteRegStr HKCU "Software\Classes\*\shell\Kural" "" "Open with Kural"
  WriteRegStr HKCU "Software\Classes\*\shell\Kural" "Icon" "$INSTDIR\Kural.exe"
  WriteRegStr HKCU "Software\Classes\*\shell\Kural\command" "" '"$INSTDIR\Kural.exe" "%1"'
  WriteRegStr HKCU "Software\Classes\Directory\shell\Kural" "" "Open with Kural"
  WriteRegStr HKCU "Software\Classes\Directory\shell\Kural" "Icon" "$INSTDIR\Kural.exe"
  WriteRegStr HKCU "Software\Classes\Directory\shell\Kural\command" "" '"$INSTDIR\Kural.exe" "%V"'
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\Kural" "" "Open with Kural"
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\Kural" "Icon" "$INSTDIR\Kural.exe"
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\Kural\command" "" '"$INSTDIR\Kural.exe" "%V"'
SectionEnd

!insertmacro MUI_FUNCTION_DESCRIPTION_BEGIN
  !insertmacro MUI_DESCRIPTION_TEXT ${SecMain} "The Kural editor."
  !insertmacro MUI_DESCRIPTION_TEXT ${SecDesktop} "A Kural icon on your desktop."
  !insertmacro MUI_DESCRIPTION_TEXT ${SecContext} "Right-click a file or folder in Explorer to open it in Kural."
!insertmacro MUI_FUNCTION_DESCRIPTION_END

Section "Uninstall"
  Delete "$SMPROGRAMS\Kural.lnk"
  Delete "$DESKTOP\Kural.lnk"
  DeleteRegKey HKCU "Software\Classes\*\shell\Kural"
  DeleteRegKey HKCU "Software\Classes\Directory\shell\Kural"
  DeleteRegKey HKCU "Software\Classes\Directory\Background\shell\Kural"
  DeleteRegKey HKCU "${UNINST}"
  DeleteRegKey HKCU "Software\Kural"
  ; Only Kural's own folder is deleted as a whole; otherwise just the uninstaller (and the folder, if that left it empty).
  Call un.KuralDirCheck
  ${If} $DirWhy == ""
    RMDir /r "$INSTDIR"
  ${Else}
    Delete "$INSTDIR\Uninstall Kural.exe"
    RMDir "$INSTDIR"
    MessageBox MB_ICONEXCLAMATION|MB_OK "Kural didn't delete $INSTDIR ($DirWhy). Delete Kural's files there yourself." /SD IDOK
  ${EndIf}
SectionEnd

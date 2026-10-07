; Kural installer for Windows 10/11 (x64). Built with NSIS (makensis), which also runs on Linux.
; Installs for the current user only: no admin rights needed.
; makensis -DVERSION=3.0.0 -DSRC=<folder with Kural.exe> -DICON=<icon.ico> -DOUT=<setup.exe> kural.nsi

Unicode true
SetCompressor /SOLID lzma
RequestExecutionLevel user

!include "MUI2.nsh"
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
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_COMPONENTS
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

!define UNINST "Software\Microsoft\Windows\CurrentVersion\Uninstall\Kural"

Section "Kural (required)" SecMain
  SectionIn RO
  ; An older Kural in this folder is replaced (your settings live elsewhere and are kept).
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
  RMDir /r "$INSTDIR"
SectionEnd

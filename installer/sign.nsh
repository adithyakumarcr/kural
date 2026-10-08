; Signs the installer and its uninstaller as makensis makes them, with scripts/sign-win.sh (Windows SmartScreen:
; "Windows protected your PC" for an unsigned installer). build-win.sh passes -DSIGN=<that script> only when a code
; signing certificate is set up; scripts/sign-win-check.sh checks this with a throwaway certificate in CI.
; (!uninstfinalize: NSIS 3.08 or newer.)
!ifdef SIGN
  !finalize '"${SIGN}" "%1"' = 0
  !uninstfinalize '"${SIGN}" "%1"' = 0
!endif

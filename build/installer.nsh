; Keep these macros short — nsExec that hangs freezes the Next button.

!macro KillWatchtower
  ; /F /T returns quickly even if the process is missing (exit code 128).
  nsExec::Exec 'cmd /c taskkill /F /IM Watchtower.exe /T >nul 2>&1 & exit /b 0'
  Pop $0
!macroend

!macro customInstall
  !insertmacro KillWatchtower
!macroend

!macro customUnInstall
  !insertmacro KillWatchtower
!macroend

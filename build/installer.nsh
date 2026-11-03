!include LogicLib.nsh

!macro KillWatchtower
  DetailPrint "Closing Watchtower if it is still running..."
  nsExec::ExecToLog 'taskkill /F /IM Watchtower.exe /T'
  Sleep 800
!macroend

!macro customCheckAppRunning
  !insertmacro KillWatchtower
!macroend

!macro customInstall
  !insertmacro KillWatchtower
!macroend

!macro customUnInit
  !insertmacro KillWatchtower
!macroend

!macro customUnInstall
  !insertmacro KillWatchtower
!macroend

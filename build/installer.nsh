!macro registerUrlProtocol SCHEME
  DeleteRegKey SHELL_CONTEXT "Software\Classes\${SCHEME}"
  WriteRegStr SHELL_CONTEXT "Software\Classes\${SCHEME}" "" "URL:${SCHEME}"
  WriteRegStr SHELL_CONTEXT "Software\Classes\${SCHEME}" "URL Protocol" ""
  WriteRegStr SHELL_CONTEXT "Software\Classes\${SCHEME}\shell" "" "open"
  WriteRegStr SHELL_CONTEXT "Software\Classes\${SCHEME}\shell\open\command" "" '"$appExe" "%1"'
!macroend

!macro customInstall
  !insertmacro registerUrlProtocol "kiwi"
  !insertmacro registerUrlProtocol "bananas"
!macroend

!macro customUnInstall
  DeleteRegKey SHELL_CONTEXT "Software\Classes\kiwi"
  DeleteRegKey SHELL_CONTEXT "Software\Classes\bananas"
!macroend

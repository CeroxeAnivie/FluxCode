!macro NSIS_HOOK_POSTUNINSTALL
  ; Tauri's checkbox removes per-user app directories. FluxCode stores its data
  ; beside the executable, so delete that directory only on explicit uninstall.
  ${If} $DeleteAppDataCheckboxState = 1
  ${AndIf} $UpdateMode <> 1
    IfFileExists "$INSTDIR\data\storage-layout.toml" 0 flux_data_done
    Push $0
    Push $1
    System::Call 'kernel32::GetFileAttributesW(w "$INSTDIR\data") i .r0'
    IntOp $1 $0 & 0x400
    ${If} $0 <> -1
    ${AndIf} $1 = 0
      RMDir /r "$INSTDIR\data"
      RMDir "$INSTDIR"
    ${EndIf}
    Pop $1
    Pop $0
    flux_data_done:
  ${EndIf}
!macroend

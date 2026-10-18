; Called only after successful interactive uninstall and an explicit UI choice.
; The defaults are fixed application roots; tests override them at compile time.
!define /ifndef VOXCUE_INSTALLER_DATA_DIRECTORY "$APPDATA\VoxCue"
!define /ifndef VOXCUE_INSTALLER_LEGACY_DATA_DIRECTORY "$APPDATA\ai-interview-copilot"

; Reject redirected roots and descendants before removing either data tree.
; Stack: absolute path -> 0 (safe/absent) or 1 (unreadable/redirected).
Function un.VoxCueCheckDataPath
  Exch $0
  Push $1
  Push $2
  Push $3
  Push $4
  StrCpy $4 0
  System::Call 'kernel32::GetFileAttributesW(w r0)i.r1 ?e'
  Pop $2
  ${If} $1 == -1
    ${If} $2 != 2
    ${AndIf} $2 != 3
      StrCpy $4 1
    ${EndIf}
    Goto voxcue_data_checked
  ${EndIf}
  IntOp $2 $1 & 0x400
  ${If} $2 != 0
    StrCpy $4 1
    Goto voxcue_data_checked
  ${EndIf}
  IntOp $2 $1 & 0x10
  ${If} $2 != 0
    FindFirst $2 $3 "$0\*"
    ${DoWhile} $3 != ""
      ${If} $3 != "."
      ${AndIf} $3 != ".."
        Push "$0\$3"
        Call un.VoxCueCheckDataPath
        Pop $4
        ${If} $4 != 0
          ${ExitDo}
        ${EndIf}
      ${EndIf}
      FindNext $2 $3
    ${Loop}
    FindClose $2
  ${EndIf}
  voxcue_data_checked:
  StrCpy $0 $4
  Pop $4
  Pop $3
  Pop $2
  Pop $1
  Exch $0
FunctionEnd

Function un.VoxCueRemoveData
  SetShellVarContext current
  Push "${VOXCUE_INSTALLER_DATA_DIRECTORY}"
  Call un.VoxCueCheckDataPath
  Pop $0
  Push "${VOXCUE_INSTALLER_LEGACY_DATA_DIRECTORY}"
  Call un.VoxCueCheckDataPath
  Pop $1
  StrCpy $2 0
  ${If} $0 != 0
  ${OrIf} $1 != 0
    StrCpy $2 1
  ${Else}
    System::Call 'kernel32::GetFileAttributesW(w "${VOXCUE_INSTALLER_DATA_DIRECTORY}")i.r0'
    ${If} $0 != -1
      ClearErrors
      RMDir /r "${VOXCUE_INSTALLER_DATA_DIRECTORY}"
      ${If} ${Errors}
        StrCpy $2 1
      ${EndIf}
    ${EndIf}
    System::Call 'kernel32::GetFileAttributesW(w "${VOXCUE_INSTALLER_LEGACY_DATA_DIRECTORY}")i.r0'
    ${If} $0 != -1
      ClearErrors
      RMDir /r "${VOXCUE_INSTALLER_LEGACY_DATA_DIRECTORY}"
      ${If} ${Errors}
        StrCpy $2 1
      ${EndIf}
    ${EndIf}
  ${EndIf}
  ${If} $installMode == "all"
    SetShellVarContext all
  ${EndIf}
  ${If} $2 != 0
    SetErrors
  ${Else}
    ClearErrors
  ${EndIf}
FunctionEnd

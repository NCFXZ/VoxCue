; Installer-only, independent of the visible frontend. Never creates or removes
; the candidate directory. The engine repeats this check immediately before its
; install section, including silent and explicit /D invocations.
!include FileFunc.nsh

Var VoxCueRegisteredDirectory
Var VoxCueCheckedDirectory
Var VoxCueRepairMissingDirectory

; Builder declares executable/registry names after loading its custom include.
!macro VoxCueInstallDirectoryFunctions
Function VoxCueCheckInstallDirectory
  Push $0
  Push $1
  Push $2
  Push $3
  Push $4
  Push $5
  StrCpy $VoxCueCheckedDirectory ""
  StrCpy $0 $INSTDIR
  ; Require a local absolute path, excluding drive roots and device/UNC aliases.
  StrCpy $1 $0 1 1
  StrCmp $1 ":" 0 voxcue_directory_checked
  StrCpy $1 $0 1 2
  StrCmp $1 "\" 0 voxcue_directory_checked
  System::Call 'kernel32::GetFullPathNameW(w r0,i ${NSIS_MAX_STRLEN},w .r1,p0)i.r2'
  ${If} $2 == 0
  ${OrIf} $2 >= ${NSIS_MAX_STRLEN}
    Goto voxcue_directory_checked
  ${EndIf}
  StrCpy $0 $1
  voxcue_directory_trim:
    StrLen $2 $0
    ${If} $2 <= 3
      Goto voxcue_directory_checked
    ${EndIf}
    StrCpy $1 $0 1 -1
    ${If} $1 == "\"
      StrCpy $0 $0 -1
      Goto voxcue_directory_trim
    ${EndIf}

  ${If} $VoxCueRegisteredDirectory != ""
  ${AndIf} $0 != $VoxCueRegisteredDirectory
    Goto voxcue_directory_checked
  ${EndIf}

  ; Every existing ancestor must be a real directory. Missing descendants are
  ; allowed, but permission errors and other unreadable paths fail closed.
  StrCpy $1 $0
  voxcue_directory_ancestor:
    System::Call 'kernel32::GetFileAttributesW(w r1)i.r2 ?e'
    Pop $3
    ${If} $2 == -1
      ${If} $3 != 2
      ${AndIf} $3 != 3
        Goto voxcue_directory_checked
      ${EndIf}
    ${Else}
      IntOp $3 $2 & 0x400
      ${If} $3 != 0
        Goto voxcue_directory_checked
      ${EndIf}
      IntOp $3 $2 & 0x10
      ${If} $3 == 0
        Goto voxcue_directory_checked
      ${EndIf}
    ${EndIf}
    StrLen $2 $1
    ${If} $2 == 3
      Goto voxcue_directory_target
    ${EndIf}
    ${GetParent} $1 $2
    StrLen $3 $2
    ${If} $3 == 2
      StrCpy $2 "$2\"
    ${EndIf}
    StrCmp $2 "" voxcue_directory_target
    StrCmp $1 $2 voxcue_directory_target
    StrCpy $1 $2
    Goto voxcue_directory_ancestor

  voxcue_directory_target:
    System::Call 'kernel32::GetFileAttributesW(w r0)i.r1 ?e'
    Pop $2
    ${If} $1 == -1
      ${If} $2 == 2
      ${OrIf} $2 == 3
        ${If} $VoxCueRegisteredDirectory != ""
          ; Only a complete, matching registration can repair its wholly absent
          ; directory. The install section removes this orphan metadata before
          ; Builder can try to execute its missing old uninstaller.
          ReadRegStr $1 HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
          StrCmp $1 $VoxCueRegisteredDirectory 0 voxcue_directory_checked
          ReadRegStr $1 HKCU "${UNINSTALL_REGISTRY_KEY}" UninstallString
          StrCmp $1 '$\"$0\${UNINSTALL_FILENAME}$\" /currentuser' 0 voxcue_directory_checked
          !ifdef UNINSTALL_REGISTRY_KEY_2
            ReadRegStr $1 HKCU "${UNINSTALL_REGISTRY_KEY_2}" UninstallString
            ${If} $1 != ""
              StrCmp $1 '$\"$0\${UNINSTALL_FILENAME}$\" /currentuser' 0 voxcue_directory_checked
            ${EndIf}
          !endif
          StrCpy $VoxCueRepairMissingDirectory "true"
        ${EndIf}
        Goto voxcue_directory_accepted
      ${EndIf}
      Goto voxcue_directory_checked
    ${EndIf}
    ; A directory recreated after repair selection must not turn into an
    ; ordinary upgrade, even if it contains plausible executable filenames.
    StrCmp $VoxCueRepairMissingDirectory "true" voxcue_directory_checked
    ; A registry entry alone cannot authorize overwriting an unrelated folder.
    ; Preserve only the registered path with the expected ordinary application,
    ; uninstaller and matching current-user uninstall registration.
    ${If} $VoxCueRegisteredDirectory != ""
    ${AndIf} $0 == $VoxCueRegisteredDirectory
      System::Call 'kernel32::GetFileAttributesW(w "$0\${APP_EXECUTABLE_FILENAME}")i.r1'
      ${If} $1 == -1
        Goto voxcue_directory_checked
      ${EndIf}
      IntOp $2 $1 & 0x410
      ${If} $2 != 0
        Goto voxcue_directory_checked
      ${EndIf}
      System::Call 'kernel32::GetFileAttributesW(w "$0\${UNINSTALL_FILENAME}")i.r1'
      ${If} $1 == -1
        Goto voxcue_directory_checked
      ${EndIf}
      IntOp $2 $1 & 0x410
      ${If} $2 != 0
        Goto voxcue_directory_checked
      ${EndIf}
      ReadRegStr $1 HKCU "${UNINSTALL_REGISTRY_KEY}" UninstallString
      StrCmp $1 '$\"$0\${UNINSTALL_FILENAME}$\" /currentuser' voxcue_directory_accepted voxcue_directory_checked
    ${EndIf}

    ; Query Win32's error value together with the operation. NSIS FindNext can
    ; overwrite GetLastError while converting its filename output.
    System::Alloc 592
    Pop $1
    StrCmp $1 0 voxcue_directory_checked
    System::Call 'kernel32::FindFirstFileW(w "$0\*",p r1)p.r2 ?e'
    Pop $4
    ${If} $2 == -1
      System::Free $1
      StrCmp $4 2 voxcue_directory_accepted voxcue_directory_checked
    ${EndIf}
    voxcue_directory_entry:
      ; WIN32_FIND_DATAW.cFileName follows eleven DWORD fields.
      IntOp $5 $1 + 44
      System::Call '*$5(&w260 .r3)'
      ${If} $3 != "."
      ${AndIf} $3 != ".."
        System::Call 'kernel32::FindClose(p r2)'
        System::Free $1
        Goto voxcue_directory_checked
      ${EndIf}
      System::Call 'kernel32::FindNextFileW(p r2,p r1)i.r3 ?e'
      Pop $4
      ${If} $3 == 0
        System::Call 'kernel32::FindClose(p r2)'
        System::Free $1
        StrCmp $4 18 voxcue_directory_accepted voxcue_directory_checked
      ${EndIf}
      Goto voxcue_directory_entry

  voxcue_directory_accepted:
    StrCpy $VoxCueCheckedDirectory $0
  voxcue_directory_checked:
  Pop $5
  Pop $4
  Pop $3
  Pop $2
  Pop $1
  Pop $0
  ${If} $VoxCueCheckedDirectory == ""
    SetErrors
  ${Else}
    ClearErrors
  ${EndIf}
FunctionEnd

Function VoxCuePrepareMissingInstallation
  Push $0
  Push $1
  ${If} $VoxCueRepairMissingDirectory == "true"
    ; Called only once the user starts installation, after the last path check.
    ; These fixed HKCU keys describe an installation whose entire directory is
    ; absent. Do not touch userData or an existing/partially missing directory.
    Call VoxCueRequireInstallDirectory
    ClearErrors
    DeleteRegKey HKCU "${INSTALL_REGISTRY_KEY}"
    IfErrors voxcue_missing_repair_failed
    DeleteRegKey HKCU "${UNINSTALL_REGISTRY_KEY}"
    IfErrors voxcue_missing_repair_failed
    !ifdef UNINSTALL_REGISTRY_KEY_2
      ReadRegStr $0 HKCU "${UNINSTALL_REGISTRY_KEY_2}" UninstallString
      ${If} $0 != ""
        DeleteRegKey HKCU "${UNINSTALL_REGISTRY_KEY_2}"
        IfErrors voxcue_missing_repair_failed
      ${EndIf}
    !endif
    ; The stock installer must see no old command, rather than relying on its
    ; copy/ExecWait failure handling for a stale uninstaller.
    ReadRegStr $0 HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
    ReadRegStr $1 HKCU "${UNINSTALL_REGISTRY_KEY}" UninstallString
    ${If} $0 != ""
    ${OrIf} $1 != ""
      Goto voxcue_missing_repair_failed
    ${EndIf}
    !ifdef UNINSTALL_REGISTRY_KEY_2
      ReadRegStr $0 HKCU "${UNINSTALL_REGISTRY_KEY_2}" UninstallString
      ${If} $0 != ""
        Goto voxcue_missing_repair_failed
      ${EndIf}
    !endif
    ClearErrors
  ${EndIf}
  Goto voxcue_missing_repair_done
  voxcue_missing_repair_failed:
    SetErrorLevel 2
    Quit
  voxcue_missing_repair_done:
  Pop $1
  Pop $0
FunctionEnd

Function VoxCueRequireInstallDirectory
  Push $0
  ReadRegStr $0 HKCU "${UNINSTALL_REGISTRY_KEY}" UninstallString
  ${If} $VoxCueRegisteredDirectory == ""
  ${AndIf} $0 != ""
    ; Builder would otherwise execute an old uninstaller even when its
    ; InstallLocation is missing. Only a complete registration can upgrade.
    SetErrors
  ${Else}
    Call VoxCueCheckInstallDirectory
  ${EndIf}
  Pop $0
  ${If} ${Errors}
    ${IfNot} ${Silent}
      ${If} $LANGUAGE == 2052
        MessageBox MB_OK|MB_ICONSTOP "无法使用此安装位置。"
      ${ElseIf} $LANGUAGE == 1028
        MessageBox MB_OK|MB_ICONSTOP "無法使用此安裝位置。"
      ${Else}
        MessageBox MB_OK|MB_ICONSTOP "Unable to use this installation location."
      ${EndIf}
    ${EndIf}
    SetErrorLevel 2
    Quit
  ${EndIf}
  StrCpy $INSTDIR $VoxCueCheckedDirectory
FunctionEnd
!macroend

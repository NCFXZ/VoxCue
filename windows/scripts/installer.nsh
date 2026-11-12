; The visible interface is drawn with the app's visual rules. NSIS retains
; extraction, current-user installation, uninstall and silent updater behavior.
!include LogicLib.nsh
!include TextFunc.nsh
Var VoxCueEvents
Var VoxCueStart
Var VoxCueCancel
Var VoxCueInstalling
Var VoxCueDone
Var VoxCueFailed
Var VoxCueFinish
Var VoxCueRun
Var VoxCueUiProcess
Var VoxCueDeleteData
Var VoxCueInstallDirectory
Var VoxCueCanChangePath
!define VOXCUE_INSTALLER_DATA_INCLUDE "${__FILEDIR__}\installer-data.nsh"
!ifndef BUILD_UNINSTALLER
  !ifndef VOXCUE_INSTALLER_PREVIEW
    !include "${__FILEDIR__}\installer-path.nsh"
    ; This section is declared before Builder's install section, so it runs for
    ; silent installs too, before old-version removal or application extraction.
    !macro customHeader
      !insertmacro VoxCueInstallDirectoryFunctions
      Section "-VoxCueSafeDirectory"
        StrCpy $INSTDIR $VoxCueInstallDirectory
        Call VoxCueRequireInstallDirectory
        Call VoxCuePrepareMissingInstallation
      SectionEnd
    !macroend
  !endif
!endif

; Only the current Windows user is supported. Reject machine installs before
; Builder's hidden page can elevate or select an all-users installation.
!macro VoxCueCurrentUserOnly
  ClearErrors
  ${GetParameters} $0
  ${GetOptions} $0 "--delete-app-data" $1
  ${IfNot} ${Errors}
    ${IfNot} ${Silent}
      MessageBox MB_OK|MB_ICONSTOP "Choose whether to keep your data in the VoxCue uninstaller."
    ${EndIf}
    SetErrorLevel 2
    Quit
  ${EndIf}
  ClearErrors
  ${If} ${isForAllUsers}
  ${OrIf} $hasPerMachineInstallation == "1"
    ${IfNot} ${Silent}
      MessageBox MB_OK|MB_ICONSTOP "VoxCue only supports the current Windows user. An all-users installation cannot be changed here."
    ${EndIf}
    SetErrorLevel 2
    Quit
  ${EndIf}
  !insertmacro setInstallModePerUser
  StrCpy $VoxCueCanChangePath "true"
  ${If} $perUserInstallationFolder != ""
    StrCpy $INSTDIR $perUserInstallationFolder
    StrCpy $VoxCueCanChangePath "false"
  ${EndIf}
!macroend
!macro customInit
  !insertmacro VoxCueCurrentUserOnly
  !ifndef VOXCUE_INSTALLER_PREVIEW
    StrCpy $VoxCueRegisteredDirectory ""
    ${If} $VoxCueCanChangePath == "false"
      System::Call 'kernel32::GetFullPathNameW(w "$INSTDIR",i ${NSIS_MAX_STRLEN},w .r0,p0)i.r1'
      ${If} $1 != 0
      ${AndIf} $1 < ${NSIS_MAX_STRLEN}
        StrCpy $VoxCueRegisteredDirectory $0
      ${EndIf}
    ${EndIf}
    ${If} ${Silent}
    ${OrIf} $VoxCueCanChangePath == "false"
      Call VoxCueRequireInstallDirectory
    ${EndIf}
    StrCpy $VoxCueInstallDirectory $INSTDIR
  !endif
!macroend
!macro customUnInit
  !insertmacro VoxCueCurrentUserOnly
!macroend

; The self-drawn frontend has no install-scope page to click through.
!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend

!macro VoxCueEvent NAME HANDLE
  System::Call 'kernel32::CreateEventW(p0,i1,i0,w "$VoxCueEvents-${NAME}")p.r0'
  StrCpy ${HANDLE} $0
  ${If} $0 == 0
    MessageBox MB_OK|MB_ICONSTOP "Unable to initialize the VoxCue installer."
    SetErrorLevel 2
    Quit
  ${EndIf}
!macroend

!macro VoxCueInit
  HideWindow
  !ifdef VOXCUE_INSTALLER_PREVIEW
    StrCpy $VoxCueCanChangePath "true"
  !endif
  StrCpy $VoxCueInstallDirectory $INSTDIR
  System::Call 'kernel32::GetCurrentProcessId()i.r0'
  StrCpy $VoxCueEvents "Local\VoxCue-Installer-$0-$HWNDPARENT"
  !insertmacro VoxCueEvent start $VoxCueStart
  !insertmacro VoxCueEvent cancel $VoxCueCancel
  !insertmacro VoxCueEvent installing $VoxCueInstalling
  !insertmacro VoxCueEvent done $VoxCueDone
  !insertmacro VoxCueEvent failed $VoxCueFailed
  !insertmacro VoxCueEvent finish $VoxCueFinish
  !insertmacro VoxCueEvent run $VoxCueRun
  !insertmacro VoxCueEvent delete-data $VoxCueDeleteData
  InitPluginsDir
  File /oname=$PLUGINSDIR\VoxCue.Setup.UI.exe "${VOXCUE_INSTALLER_FRONTEND}"
  File /oname=$PLUGINSDIR\brand.png "${VOXCUE_INSTALLER_LOGO}"
  !ifdef BUILD_UNINSTALLER
    StrCpy $1 "uninstall"
  !else
    StrCpy $1 "install"
  !endif
  !ifdef HIDE_RUN_AFTER_FINISH
    StrCpy $2 "false"
  !else
    StrCpy $2 "true"
  !endif
  StrCpy $3 $VoxCueCanChangePath
  !ifdef BUILD_UNINSTALLER
    StrCpy $3 "false"
  !endif
  System::Call 'kernel32::GetCurrentProcessId()i.r0'
  StrCpy $0 '$\"$PLUGINSDIR\VoxCue.Setup.UI.exe$\" $\"--owner=$0$\" $\"--window=$HWNDPARENT$\" $\"--events=$VoxCueEvents$\" $\"--version=${VERSION}$\" $\"--language=$LANGUAGE$\" $\"--mode=$1$\" $\"--run-after-finish=$2$\" $\"--logo=$PLUGINSDIR\brand.png$\" $\"--install-path=$INSTDIR$\" $\"--can-change-path=$3$\" $\"--path-file=$PLUGINSDIR\install-path.txt$\"'
  ; NSIS is 32-bit; retain only the process we create for this installation.
  System::Call 'kernel32::GlobalAlloc(i0x40,i68)p.r1'
  System::Call '*$1(i68)'
  System::Call 'kernel32::GlobalAlloc(i0x40,i16)p.r2'
  System::Call 'kernel32::CreateProcessW(p0,t r0,p0,p0,i0,i0,p0,p0,p r1,p r2)i.r3'
  ${If} $3 == 0
    System::Free $1
    System::Free $2
    MessageBox MB_OK|MB_ICONSTOP "Unable to open the VoxCue installer."
    SetErrorLevel 2
    Quit
  ${EndIf}
  System::Call '*$2(p.r3,p.r4,i,i)'
  StrCpy $VoxCueUiProcess $3
  System::Call 'kernel32::CloseHandle(p r4)'
  System::Free $1
  System::Free $2
  SetAutoClose true
!macroend

!macro VoxCueCleanup
  ${If} $VoxCueUiProcess != 0
    System::Call 'kernel32::WaitForSingleObject(p $VoxCueUiProcess,i1500)i.r0'
    ${If} $0 == 258
      System::Call 'kernel32::TerminateProcess(p $VoxCueUiProcess,i1)'
      System::Call 'kernel32::WaitForSingleObject(p $VoxCueUiProcess,i1000)'
    ${EndIf}
    System::Call 'kernel32::CloseHandle(p $VoxCueUiProcess)'
  ${EndIf}
  System::Call 'kernel32::CloseHandle(p $VoxCueStart)'
  System::Call 'kernel32::CloseHandle(p $VoxCueCancel)'
  System::Call 'kernel32::CloseHandle(p $VoxCueInstalling)'
  System::Call 'kernel32::CloseHandle(p $VoxCueDone)'
  System::Call 'kernel32::CloseHandle(p $VoxCueFailed)'
  System::Call 'kernel32::CloseHandle(p $VoxCueFinish)'
  System::Call 'kernel32::CloseHandle(p $VoxCueRun)'
  System::Call 'kernel32::CloseHandle(p $VoxCueDeleteData)'
!macroend

!ifdef BUILD_UNINSTALLER
  !define MUI_CUSTOMFUNCTION_UNGUIINIT un.VoxCueInit
  Function un.VoxCueInit
    !insertmacro VoxCueInit
  FunctionEnd
  Function un.onGUIEnd
    !insertmacro VoxCueCleanup
  FunctionEnd
!else
  !define MUI_CUSTOMFUNCTION_GUIINIT VoxCueInit
  Function VoxCueInit
    !insertmacro VoxCueInit
  FunctionEnd
  Function .onGUIEnd
    !insertmacro VoxCueCleanup
  FunctionEnd
!endif

!macro VoxCueWelcome PREFIX
  Function ${PREFIX}VoxCueWelcome
    HideWindow
    !ifndef BUILD_UNINSTALLER
      !ifndef VOXCUE_INSTALLER_PREVIEW
        ${If} ${isUpdated}
          Abort
        ${EndIf}
      !endif
    !endif
    ${Do}
      System::Call 'kernel32::WaitForSingleObject(p $VoxCueCancel,i0)i.r0'
      ${If} $0 == 0
        SetErrorLevel 1
        Quit
      ${EndIf}
      System::Call 'kernel32::WaitForSingleObject(p $VoxCueUiProcess,i0)i.r0'
      ${If} $0 == 0
        SetErrorLevel 2
        Quit
      ${EndIf}
      System::Call 'kernel32::WaitForSingleObject(p $VoxCueStart,i50)i.r0'
    ${LoopUntil} $0 == 0
    !ifndef BUILD_UNINSTALLER
      !ifndef VOXCUE_INSTALLER_PREVIEW
        ${If} $VoxCueCanChangePath == "true"
          ClearErrors
          FileOpen $0 "$PLUGINSDIR\install-path.txt" r
          IfErrors voxcue_path_invalid
          FileReadUTF16LE $0 $1
          FileClose $0
          ${TrimNewLines} $1 $1
          StrCmp $1 "" voxcue_path_invalid
          ; Canonicalize without requiring the new VoxCue subfolder to exist.
          System::Call 'kernel32::GetFullPathNameW(w r1,i ${NSIS_MAX_STRLEN},w .r3,p0)i.r4'
          ${If} $4 == 0
          ${OrIf} $4 >= ${NSIS_MAX_STRLEN}
            Goto voxcue_path_invalid
          ${EndIf}
          StrCpy $INSTDIR $3
          Call VoxCueCheckInstallDirectory
          IfErrors voxcue_path_invalid voxcue_path_valid
          voxcue_path_invalid:
          System::Call 'kernel32::SetEvent(p $VoxCueFailed)'
          ${Do}
            System::Call 'kernel32::WaitForSingleObject(p $VoxCueUiProcess,i0)i.r0'
            ${If} $0 == 0
              ${ExitDo}
            ${EndIf}
            System::Call 'kernel32::WaitForSingleObject(p $VoxCueFinish,i50)i.r0'
          ${LoopUntil} $0 == 0
          SetErrorLevel 2
          Quit
          voxcue_path_valid:
          StrCpy $VoxCueInstallDirectory $VoxCueCheckedDirectory
        ${EndIf}
      !endif
    !endif
    Abort
  FunctionEnd
!macroend

!macro VoxCueBegin PREFIX
  Function ${PREFIX}VoxCueBegin
    HideWindow
    !ifndef BUILD_UNINSTALLER
      !ifndef VOXCUE_INSTALLER_PREVIEW
        ; Builder's scope helper reapplies /D; restore our selected or locked
        ; directory after that helper, immediately before file installation.
        StrCpy $INSTDIR $VoxCueInstallDirectory
        Call VoxCueRequireInstallDirectory
      !endif
    !endif
    System::Call 'kernel32::SetEvent(p $VoxCueInstalling)'
    Abort
  FunctionEnd
  ; MUI calls the instfiles leave hook when extraction finishes, including Abort.
  ; A failed hidden engine must remain closable through the visible frontend.
  Function ${PREFIX}VoxCueFilesFinished
    IfAbort voxcue_files_failed voxcue_files_succeeded
    voxcue_files_failed:
    ${IfNot} ${Silent}
      System::Call 'kernel32::SetEvent(p $VoxCueFailed)'
      ${Do}
        System::Call 'kernel32::WaitForSingleObject(p $VoxCueUiProcess,i0)i.r0'
        ${If} $0 == 0
          ${ExitDo}
        ${EndIf}
        System::Call 'kernel32::WaitForSingleObject(p $VoxCueFinish,i50)i.r0'
      ${LoopUntil} $0 == 0
    ${EndIf}
    SetErrorLevel 2
    Quit
    voxcue_files_succeeded:
    !ifdef BUILD_UNINSTALLER
      !ifndef VOXCUE_INSTALLER_PREVIEW
        ${IfNot} ${Silent}
        ${AndIfNot} ${isUpdated}
          System::Call 'kernel32::WaitForSingleObject(p $VoxCueDeleteData,i0)i.r0'
          ${If} $0 == 0
            Call un.VoxCueRemoveData
            IfErrors voxcue_files_failed
          ${EndIf}
        ${EndIf}
      !endif
    !endif
  FunctionEnd
  !ifndef BUILD_UNINSTALLER
    !define MUI_PAGE_CUSTOMFUNCTION_LEAVE ${PREFIX}VoxCueFilesFinished
  !endif
!macroend

!macro VoxCueFinish PREFIX
  Function ${PREFIX}VoxCueFinish
    HideWindow
    System::Call 'kernel32::SetEvent(p $VoxCueDone)'
    ${Do}
      System::Call 'kernel32::WaitForSingleObject(p $VoxCueUiProcess,i0)i.r0'
      ${If} $0 == 0
        ${ExitDo}
      ${EndIf}
      System::Call 'kernel32::WaitForSingleObject(p $VoxCueFinish,i50)i.r0'
    ${LoopUntil} $0 == 0
    !ifndef BUILD_UNINSTALLER
      !ifndef HIDE_RUN_AFTER_FINISH
        !ifndef VOXCUE_INSTALLER_PREVIEW
          System::Call 'kernel32::WaitForSingleObject(p $VoxCueRun,i0)i.r0'
          ${If} $0 == 0
            ${If} ${isUpdated}
              StrCpy $1 "--updated"
            ${Else}
              StrCpy $1 ""
            ${EndIf}
            ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "$1"
          ${EndIf}
        !endif
      !endif
    !endif
    Abort
  FunctionEnd
!macroend

!macro customWelcomePage
  !insertmacro VoxCueWelcome ""
  Page custom VoxCueWelcome
!macroend
!macro customPageAfterChangeDir
  !insertmacro VoxCueBegin ""
  Page custom VoxCueBegin
!macroend
!macro customFinishPage
  !insertmacro VoxCueFinish ""
  Page custom VoxCueFinish
!macroend
!macro customUnWelcomePage
  !ifndef VOXCUE_INSTALLER_PREVIEW
    !include "${VOXCUE_INSTALLER_DATA_INCLUDE}"
  !endif
  !insertmacro VoxCueWelcome "un."
  !insertmacro VoxCueBegin "un."
  UninstPage custom un.VoxCueWelcome
  UninstPage custom un.VoxCueBegin
  !include "${VOXCUE_INSTALLER_UNINSTALL_PAGE}"
!macroend

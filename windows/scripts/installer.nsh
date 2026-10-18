; The visible interface is drawn with the app's visual rules. NSIS retains
; extraction, current-user installation, uninstall and silent updater behavior.
!include LogicLib.nsh
Var VoxCueEvents
Var VoxCueStart
Var VoxCueCancel
Var VoxCueInstalling
Var VoxCueDone
Var VoxCueFailed
Var VoxCueFinish
Var VoxCueRun
Var VoxCueUiProcess

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
  System::Call 'kernel32::GetCurrentProcessId()i.r0'
  StrCpy $VoxCueEvents "Local\VoxCue-Installer-$0-$HWNDPARENT"
  !insertmacro VoxCueEvent start $VoxCueStart
  !insertmacro VoxCueEvent cancel $VoxCueCancel
  !insertmacro VoxCueEvent installing $VoxCueInstalling
  !insertmacro VoxCueEvent done $VoxCueDone
  !insertmacro VoxCueEvent failed $VoxCueFailed
  !insertmacro VoxCueEvent finish $VoxCueFinish
  !insertmacro VoxCueEvent run $VoxCueRun
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
  System::Call 'kernel32::GetCurrentProcessId()i.r0'
  StrCpy $0 '$\"$PLUGINSDIR\VoxCue.Setup.UI.exe$\" $\"--owner=$0$\" $\"--window=$HWNDPARENT$\" $\"--events=$VoxCueEvents$\" $\"--version=${VERSION}$\" $\"--language=$LANGUAGE$\" $\"--mode=$1$\" $\"--run-after-finish=$2$\" $\"--logo=$PLUGINSDIR\brand.png$\"'
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
    Abort
  FunctionEnd
!macroend

!macro VoxCueBegin PREFIX
  Function ${PREFIX}VoxCueBegin
    HideWindow
    System::Call 'kernel32::SetEvent(p $VoxCueInstalling)'
    Abort
  FunctionEnd
  ; MUI calls the instfiles leave hook when extraction finishes, including Abort.
  ; A failed hidden engine must remain closable through the visible frontend.
  Function ${PREFIX}VoxCueFilesFinished
    IfAbort 0 voxcue_files_succeeded
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
  FunctionEnd
  !define MUI_PAGE_CUSTOMFUNCTION_LEAVE ${PREFIX}VoxCueFilesFinished
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
  !insertmacro VoxCueWelcome "un."
  !insertmacro VoxCueBegin "un."
  UninstPage custom un.VoxCueWelcome
  UninstPage custom un.VoxCueBegin
  !include "${VOXCUE_INSTALLER_UNINSTALL_PAGE}"
!macroend

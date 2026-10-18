; Builder inserts its install-scope page after our welcome macro. Bind this
; callback at the real file page so that scope page cannot consume it first.
!macroundef MUI_UNPAGE_INSTFILES
!macro MUI_UNPAGE_INSTFILES
  !define MUI_PAGE_CUSTOMFUNCTION_LEAVE un.VoxCueFilesFinished
  !insertmacro MUI_UNPAGE_INIT
  !insertmacro MUI_PAGEDECLARATION_INSTFILES
!macroend

!macroundef MUI_UNPAGE_FINISH
!macro MUI_UNPAGE_FINISH
  !insertmacro VoxCueFinish "un."
  UninstPage custom un.VoxCueFinish
!macroend

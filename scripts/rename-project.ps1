# Run after closing editors/apps that hold the old project directory open.
$ErrorActionPreference = 'Stop'
$sourceRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$parentRoot = [IO.Path]::GetDirectoryName($sourceRoot)
$destinationRoot = [IO.Path]::GetFullPath((Join-Path $parentRoot 'VoxCue'))
try {
  if ([IO.Path]::GetFileName($sourceRoot) -eq 'VoxCue') { Write-Host 'Project is already named VoxCue.'; exit 0 }
  if ([IO.Path]::GetFileName($sourceRoot) -ne 'AI_Interview_Copilot' -or
      [IO.Path]::GetDirectoryName($destinationRoot) -ne $parentRoot) { throw 'Unexpected project path.' }
  if (Test-Path -LiteralPath $destinationRoot) { throw 'VoxCue already exists; no files were changed.' }
  Set-Location -LiteralPath $parentRoot
  [Environment]::CurrentDirectory = $parentRoot
  Start-Sleep -Milliseconds 500
  Rename-Item -LiteralPath $sourceRoot -NewName 'VoxCue'
  Write-Host "Renamed project: $destinationRoot"
  Write-Host 'Open the VoxCue folder and use Start-VoxCue.cmd.'
} catch {
  Write-Host $_.Exception.Message -ForegroundColor Red
  Write-Host 'Close Codex, VS Code, terminals and apps using this folder, then run Rename-to-VoxCue.cmd again.'
}
Read-Host 'Press Enter to close'

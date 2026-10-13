param([Parameter(Mandatory=$true)][string]$AudioFile,[int]$Seconds=15)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System
$player=New-Object System.Media.SoundPlayer($AudioFile)
try { $player.Load(); $player.PlaySync() } finally { $player.Dispose() }

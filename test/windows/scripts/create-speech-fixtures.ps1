$ErrorActionPreference = 'Stop'
$fixtureRoot = Join-Path (Get-Location) 'test/results/speech-fixtures'
New-Item -ItemType Directory -Force -Path $fixtureRoot | Out-Null
$sentences = (Get-Content -LiteralPath 'test/shared/fixtures/speech-v1.json' -Raw -Encoding UTF8 | ConvertFrom-Json).cases
foreach($item in $sentences){ if($item.repeat){$item.text=$item.text * $item.repeat} }
$synth = New-Object -ComObject SAPI.SpVoice
try {
  foreach($item in $sentences) {
    $token = New-Object -ComObject SAPI.SpObjectToken
    $voiceName = if($item.voice){$item.voice}else{'MSTTS_V110_enUS_ZiraM'}
    $token.SetId(('HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Speech_OneCore\Voices\Tokens\'+$voiceName))
    $synth.Voice = $token
    $stream = New-Object -ComObject SAPI.SpFileStream
    $stream.Format.Type = 18
    $stream.Open((Join-Path $fixtureRoot ($item.id+'.wav')),3,$false)
    $synth.AudioOutputStream = $stream
    [void]$synth.Speak($item.text)
    $stream.Close()
    [void][Runtime.InteropServices.Marshal]::ReleaseComObject($stream)
    [void][Runtime.InteropServices.Marshal]::ReleaseComObject($token)
  }
} finally { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($synth) }
$sentences | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $fixtureRoot 'references.json') -Encoding utf8

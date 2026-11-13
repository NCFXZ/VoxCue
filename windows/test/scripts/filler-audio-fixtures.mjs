import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { testRoot, spawnTestProcess } from '../../../shared/test/scripts/test-workspace.mjs';
import { probe } from './window-probe.mjs';

const voices = {
  Huihui: 'MSTTS_V110_zhCN_HuihuiM',
  Kangkang: 'MSTTS_V110_zhCN_KangkangM',
};
const cases = [
  { id: 'ack', text: '好的。', kind: 'filler' },
  { id: 'um', text: '嗯。嗯。', kind: 'filler' },
  { id: 'ah', text: '啊。', kind: 'filler' },
  { id: 'uh', text: '呃。呃。', kind: 'filler' },
  { id: 'um-sustained', text: '嗯嗯嗯嗯。', rate: -4, kind: 'filler' },
  { id: 'ah-sustained', text: '啊啊啊啊啊啊啊啊。', rate: -4, kind: 'filler' },
  { id: 'uh-sustained', text: '额，额，额。', rate: -4, kind: 'filler' },
  { id: 'question', text: '请介绍你的项目经历。', kind: 'question' },
  { id: 'mixed', text: '嗯，请介绍你的项目经历。', kind: 'question' },
  { id: 'followup', text: '然后呢？', kind: 'question' },
];

// File-only TTS waveforms, never microphone capture or a human-recorded corpus.
export async function prepareFillerAudio({ voice = 'Huihui' } = {}) {
  assert.equal(process.platform, 'win32');
  assert.ok(Object.hasOwn(voices, voice), 'Unsupported synthetic SAPI voice');
  assert.equal(probe('desktop').interactive, true, 'Speech fixtures require an unlocked desktop');
  const directory = await mkdtemp(path.join(testRoot, 'filler-audio-'));
  const audio = cases.map((item) => ({ ...item, wave: path.join(directory, item.id + '.wav') }));
  const configuration = path.join(directory, 'speech.json');
  await writeFile(configuration, JSON.stringify({ voice: voices[voice], audio }));
  const scriptSource = `param([Parameter(Mandatory=$true)][string]$Configuration)
$ErrorActionPreference = 'Stop'
$inputData = Get-Content -LiteralPath $Configuration -Raw -Encoding UTF8 | ConvertFrom-Json
$synth = $null
$token = $null
function Release-Com($value) {
  if ($null -ne $value -and [Runtime.InteropServices.Marshal]::IsComObject($value)) {
    [void][Runtime.InteropServices.Marshal]::ReleaseComObject($value)
  }
}
try {
  $synth = New-Object -ComObject SAPI.SpVoice
  $token = New-Object -ComObject SAPI.SpObjectToken
  $token.SetId('HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Speech_OneCore\\Voices\\Tokens\\' + $inputData.voice)
  $synth.Voice = $token
  foreach ($item in $inputData.audio) {
    $synth.Rate = [int]$item.rate
    $stream = $null
    $format = $null
    try {
      $stream = New-Object -ComObject SAPI.SpFileStream
      $format = $stream.Format
      $format.Type = 18
      $stream.Open($item.wave, 3, $false)
      $synth.AudioOutputStream = $stream
      [void]$synth.Speak($item.text)
    } finally {
      try { if ($null -ne $stream) { $stream.Close() } }
      finally { try { Release-Com $format } finally { Release-Com $stream } }
    }
  }
} finally {
  try { Release-Com $synth } finally { Release-Com $token }
}
`;
  const powershell = path.join(
    process.env.SystemRoot ?? process.env.WINDIR ?? 'C:\\Windows',
    'System32/WindowsPowerShell/v1.0/powershell.exe',
  );
  const child = spawnTestProcess(
    powershell,
    [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-STA',
      '-Command',
      `& {\n${scriptSource}\n} -Configuration $env:VOXCUE_TEST_SAPI_CONFIGURATION`,
    ],
    {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      env: { ...process.env, VOXCUE_TEST_SAPI_CONFIGURATION: configuration },
    },
  );
  let diagnostic = '';
  const collect = (bytes) => {
    diagnostic = (diagnostic + bytes.toString()).slice(-4000);
  };
  child.stdout.on('data', collect);
  child.stderr.on('data', collect);
  const timer = setTimeout(() => child.kill('SIGKILL'), 60000);
  try {
    const [code] = await once(child, 'exit');
    assert.equal(code, 0, 'Synthetic SAPI audio generation failed: ' + diagnostic);
  } finally {
    clearTimeout(timer);
  }
  for (const item of audio) {
    const bytes = await readFile(item.wave);
    assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
    assert.equal(bytes.toString('ascii', 8, 12), 'WAVE');
    let format, pcm;
    for (let at = 12; at + 8 <= bytes.length;) {
      const size = bytes.readUInt32LE(at + 4),
        chunk = bytes.subarray(at + 8, at + 8 + size);
      assert.ok(at + 8 + size <= bytes.length, 'Truncated synthetic WAV');
      if (bytes.toString('ascii', at, at + 4) === 'fmt ') format = chunk;
      if (bytes.toString('ascii', at, at + 4) === 'data') pcm = chunk;
      at += 8 + size + (size % 2);
    }
    assert.ok(format?.length >= 16 && pcm?.length > 0 && pcm.some((value) => value !== 0));
    assert.equal(format.readUInt16LE(0), 1);
    assert.equal(format.readUInt16LE(2), 1);
    assert.equal(format.readUInt32LE(4), 16000);
    assert.equal(format.readUInt16LE(14), 16);
    item.sha256 = createHash('sha256').update(bytes).digest('hex');
  }
  return audio;
}

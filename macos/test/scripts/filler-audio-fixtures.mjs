import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile } from 'node:fs/promises';
import path from 'node:path';
import { testRoot, spawnTestProcess } from '../../../shared/test/scripts/test-workspace.mjs';
import { watchTestDesktop } from '../../../shared/test/scripts/desktop-guard.mjs';
import { requireUnlockedDesktop } from './desktop-session.mjs';

const question = { id: 'question', text: '请介绍你的项目经历。', kind: 'question' };
const fillerCases = [
  { id: 'ack', text: '好的。', kind: 'filler' },
  // The installed voice must produce sustained filler speech that crosses the
  // unchanged production VAD gate. The caller still requires actual ASR text.
  { id: 'um', text: '嗯嗯。', rate: 80, kind: 'filler' },
  { id: 'ah', text: '啊啊啊啊啊啊啊啊。', rate: 80, kind: 'filler' },
  { id: 'uh', text: '额，额，额。', rate: 80, kind: 'filler' },
  question,
  { id: 'mixed', text: '嗯，请介绍你的项目经历。', kind: 'question' },
  { id: 'followup', text: '然后呢？', rate: 80, kind: 'question' },
];
const boundaryCases = [
  { id: 'um-short', text: '嗯。嗯。', kind: 'unaccepted' },
  { id: 'ah-short', text: '啊。', kind: 'unaccepted' },
  question,
];

export function prepareFillerAudio(options) {
  return prepareAudio(fillerCases, options);
}
export function prepareSpeechBoundaryAudio(options) {
  return prepareAudio(boundaryCases, options);
}

// File-only synthesis by an already installed Mac voice; no playback, capture,
// voice download or user audio. Every waveform remains in this owned run.
async function prepareAudio(cases, { voice = 'Tingting' } = {}) {
  assert.equal(process.platform, 'darwin');
  assert.match(voice, /^[\p{L}\p{N} ()（）_-]{1,80}$/u, 'Expected an installed voice name');
  requireUnlockedDesktop();
  const say = async (args) => {
    requireUnlockedDesktop();
    const child = spawnTestProcess('/usr/bin/say', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let diagnostic = '';
    const collect = (bytes) => {
      diagnostic = (diagnostic + bytes.toString()).slice(-65536);
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    const desktopGuard = watchTestDesktop(child, requireUnlockedDesktop);
    const timer = setTimeout(() => child.kill('SIGKILL'), 60_000);
    try {
      const code = await new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('exit', resolve);
      });
      if (desktopGuard.failure) throw desktopGuard.failure;
      assert.equal(code, 0, 'Installed Mac TTS voice failed: ' + diagnostic.slice(-4000));
      return diagnostic;
    } finally {
      clearTimeout(timer);
      desktopGuard.release();
    }
  };
  const installed = (await say(['-v', '?']))
    .split('\n')
    .map((line) => line.match(/^(.*?)\s+[a-z]{2,3}(?:[_-][A-Za-z0-9]+)+\s+#/u)?.[1].trim());
  const names = [...new Set(installed.filter(Boolean))];
  const matches = names.includes(voice)
    ? [voice]
    : names.filter((name) => name.startsWith(voice + ' ('));
  assert.equal(matches.length, 1, 'The selected Mac TTS voice must match one installed voice');
  voice = matches[0];
  const directory = await mkdtemp(path.join(testRoot, 'filler-audio-'));
  const audio = cases.map((item) => ({ ...item, wave: path.join(directory, item.id + '.wav') }));
  for (const item of audio) {
    await say([
      '-v',
      voice,
      '-r',
      String(item.rate ?? 160),
      '-o',
      item.wave,
      '--file-format=WAVE',
      '--data-format=LEI16@16000',
      '--channels=1',
      item.text,
    ]);
    const bytes = await readFile(item.wave);
    assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
    assert.equal(bytes.toString('ascii', 8, 12), 'WAVE');
    let format, pcm;
    for (let at = 12; at + 8 <= bytes.length;) {
      const size = bytes.readUInt32LE(at + 4);
      assert.ok(at + 8 + size <= bytes.length, 'Truncated synthetic WAV');
      const chunk = bytes.subarray(at + 8, at + 8 + size);
      if (bytes.toString('ascii', at, at + 4) === 'fmt ') format = chunk;
      if (bytes.toString('ascii', at, at + 4) === 'data') pcm = chunk;
      at += 8 + size + (size % 2);
    }
    assert.ok(format?.length >= 16 && pcm?.length && pcm.some((value) => value !== 0));
    assert.equal(format.readUInt16LE(0), 1, 'Expected PCM WAV');
    assert.equal(format.readUInt16LE(2), 1, 'Expected mono WAV');
    assert.equal(format.readUInt32LE(4), 16000);
    assert.equal(format.readUInt16LE(14), 16);
    assert.ok(pcm.length <= 60 * 16000 * 2, 'Synthetic WAV must not exceed one minute');
    item.sha256 = createHash('sha256').update(bytes).digest('hex');
    item.origin = 'macOS say / installed voice ' + voice;
  }
  return audio;
}

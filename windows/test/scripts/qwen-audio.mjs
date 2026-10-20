import assert from 'node:assert/strict';

// Deterministic synthetic continuous input from the authenticated public wave.
// Preserve all nonquiet samples byte-for-byte. Only near-zero runs >=300ms
// (absolute PCM16 <=16, below -66dBFS) lose their middle, retaining 160ms.
export function continuousWave(wave) {
  let pcm, format;
  for (let cursor = 12; cursor + 8 <= wave.length;) {
    const size = wave.readUInt32LE(cursor + 4);
    const kind = wave.toString('ascii', cursor, cursor + 4);
    if (kind === 'data') pcm = wave.subarray(cursor + 8, cursor + 8 + size);
    if (kind === 'fmt ') format = wave.subarray(cursor + 8, cursor + 8 + size);
    cursor += 8 + size + (size % 2);
  }
  assert.ok(pcm && format);
  assert.equal(format.readUInt16LE(0), 1);
  assert.equal(format.readUInt16LE(2), 1);
  assert.equal(format.readUInt32LE(4), 16000);
  assert.equal(format.readUInt16LE(14), 16);
  const chunks = [];
  let from = 0,
    quiet;
  const finish = (end) => {
    if (quiet !== undefined && end - quiet >= 9600) {
      chunks.push(pcm.subarray(from, quiet + 2560));
      from = end - 2560;
    }
    quiet = undefined;
  };
  for (let at = 0; at < pcm.length; at += 320) {
    let low = true;
    for (let i = at; i < Math.min(at + 320, pcm.length); i += 2)
      if (Math.abs(pcm.readInt16LE(i)) > 16) {
        low = false;
        break;
      }
    if (low) quiet ??= at;
    else finish(at);
  }
  finish(pcm.length);
  chunks.push(pcm.subarray(from));
  const audio = Buffer.concat(chunks);
  assert.ok(audio.length < pcm.length, 'Continuous fixture must contain an actual quiet run');
  const header = Buffer.alloc(44);
  header.write('RIFF');
  header.writeUInt32LE(audio.length + 36, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  format.copy(header, 20, 0, 16);
  header.write('data', 36);
  header.writeUInt32LE(audio.length, 40);
  return Buffer.concat([header, audio]);
}

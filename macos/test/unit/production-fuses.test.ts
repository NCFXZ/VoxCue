import { expect, it } from 'vitest';
import { writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { testRoot } from '../../../shared/test/scripts/test-workspace.mjs';
import { productionFuses } from '../../scripts/production-runtime.mjs';

const sentinel = Buffer.from('dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX');
it('patches a unique cross-block V1 wire, preserves unrelated fuses, and verifies the result', async () => {
  const file = path.join(testRoot, 'fuse-boundary');
  const bytes = Buffer.concat([
    Buffer.alloc(1024 * 1024 - 10),
    sentinel,
    Buffer.from([1, 9]),
    Buffer.from('101100110'),
    Buffer.from('unchanged suffix'),
  ]);
  await writeFile(file, bytes);
  await expect(productionFuses(file)).rejects.toThrow('Unsafe');
  expect(await productionFuses(file, { write: true })).toBe('000011110');
  expect(await productionFuses(file)).toBe('000011110');
  const changed = await readFile(file);
  expect(changed.subarray(0, 1024 * 1024 - 10 + sentinel.length + 2)).toEqual(
    bytes.subarray(0, 1024 * 1024 - 10 + sentinel.length + 2),
  );
  expect(changed.subarray(-16)).toEqual(bytes.subarray(-16));
});
it.each(['missing', 'duplicate', 'schema', 'removed', 'truncated'])(
  'refuses %s without changing the runtime',
  async (mode) => {
    const base = Buffer.concat([sentinel, Buffer.from([1, 6]), Buffer.from('101100')]);
    const bytes =
      mode === 'missing'
        ? Buffer.alloc(100)
        : mode === 'duplicate'
          ? Buffer.concat([base, base])
          : Buffer.from(base);
    if (mode === 'schema') bytes[sentinel.length] = 2;
    if (mode === 'removed') bytes[sentinel.length + 2] = 0x72;
    const content = mode === 'truncated' ? bytes.subarray(0, -2) : bytes;
    const file = path.join(testRoot, 'fuse-' + mode);
    await writeFile(file, content);
    await expect(productionFuses(file, { write: true })).rejects.toThrow();
    expect(await readFile(file)).toEqual(content);
  },
);

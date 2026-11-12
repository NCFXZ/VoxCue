import { expect, it, vi } from 'vitest';
import { audioControlReader } from '../scripts/audio-virtual-control.mjs';
import { BoundedLineDecoder } from '../../../shared/electron/backend/speech/buffer';

it('decodes fragmented UTF-8 control records', () => {
  const event = vi.fn(),
    failure = vi.fn();
  const read = audioControlReader(BoundedLineDecoder, event, failure);
  const bytes = Buffer.from('{"type":"started","name":"合成"}\n');
  for (const byte of bytes) read(Buffer.from([byte]));
  expect(event).toHaveBeenCalledWith({ type: 'started', name: '合成' });
  expect(failure).not.toHaveBeenCalled();
});
it('reports a malformed record even after readiness was already fulfilled', async () => {
  let ready!: () => void;
  const started = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const failure = vi.fn();
  const read = audioControlReader(BoundedLineDecoder, () => ready(), failure);
  read(Buffer.from('{"type":"started"}\n'));
  await started;
  read(Buffer.from('{bad\n'));
  read(Buffer.alloc(1024 * 1024));
  expect(failure).toHaveBeenCalledOnce();
  expect(failure.mock.calls[0][0]).toBeInstanceOf(Error);
});
it('bounds cumulative output after ready, including many short records', () => {
  const failure = vi.fn(),
    events = vi.fn();
  const read = audioControlReader(BoundedLineDecoder, events, failure, false, 32);
  read(Buffer.from('{"ready":true}\n'));
  for (let count = 0; count < 100; count++) read(Buffer.from('{}\n'));
  expect(failure).toHaveBeenCalledOnce();
  expect(events.mock.calls.length).toBeLessThan(10);
});
it('rejects an oversized chunk before buffering or parsing any of it', () => {
  const failure = vi.fn(),
    events = vi.fn();
  const read = audioControlReader(BoundedLineDecoder, events, failure);
  read(Buffer.alloc(10001));
  read(Buffer.from('{"ready":true}\n'));
  expect(failure).toHaveBeenCalledOnce();
  expect(events).not.toHaveBeenCalled();
});
it('bounds framework diagnostics while accepting its JSON control protocol', () => {
  const failure = vi.fn(),
    events = vi.fn();
  const read = audioControlReader(BoundedLineDecoder, events, failure, true, 40);
  read(Buffer.from('framework diagnostic\n{}\n'));
  expect(events).toHaveBeenCalledWith({});
  read(Buffer.alloc(40));
  expect(failure).toHaveBeenCalledOnce();
});
it('rejects semantic errors and malformed metadata without exposing remote text', () => {
  const failure = vi.fn();
  const read = audioControlReader(
    BoundedLineDecoder,
    () => {
      throw Error('untrusted diagnostic');
    },
    failure,
  );
  read(Buffer.from('{"error":"untrusted diagnostic"}\n'));
  expect(failure.mock.calls[0][0].message).not.toContain('untrusted diagnostic');
});

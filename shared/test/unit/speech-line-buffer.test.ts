import { expect, it } from 'vitest';
import { BoundedLineDecoder } from '../../electron/backend/speech/buffer';

it('decodes UTF-8 split across chunks and treats the limit as bytes per line', () => {
  const lines = new BoundedLineDecoder(6);
  const bytes = Buffer.from('你好\r\n');
  expect(lines.push(bytes.subarray(0, 1))).toEqual([]);
  expect(lines.push(bytes.subarray(1, 6))).toEqual([]);
  // CR is part of the bounded protocol, so this line needs seven bytes.
  expect(() => lines.push(bytes.subarray(6))).toThrow('exceeds limit');
  const valid = new BoundedLineDecoder(7);
  expect(valid.push(bytes.subarray(0, 1))).toEqual([]);
  expect(valid.push(bytes.subarray(1))).toEqual(['你好']);
});

it('rejects a fragmented unterminated line before retaining bytes above the limit', () => {
  const lines = new BoundedLineDecoder(8);
  expect(lines.push(Buffer.from('1234'))).toEqual([]);
  expect(lines.push(Buffer.from('5678'))).toEqual([]);
  expect(() => lines.push(Buffer.from('9'))).toThrow('exceeds limit');
  expect(lines.finish()).toBe('');
});

it('accepts many bounded lines in a large chunk and preserves the final unterminated line', () => {
  const lines = new BoundedLineDecoder(4);
  expect(lines.push(Buffer.from('a\nb\nc\nd\nend'))).toEqual(['a', 'b', 'c', 'd']);
  expect(lines.finish()).toBe('end');
  expect(() => lines.push(Buffer.from('12345\n'))).toThrow('exceeds limit');
});

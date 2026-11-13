import { describe, expect, it, vi } from 'vitest';
import { prepareChatRequest } from '../../../../shared/src/services/chat';
import { readDroppedFiles, stageAttachments } from '../../../../shared/src/services/chatOptions';
import {
  CHAT_FILE_BYTES_LIMIT,
  CHAT_FILE_LIMIT,
  CHAT_TEXT_LIMIT,
  CHAT_TURN_LIMIT,
} from '../../../../shared/electron/contracts/chat';

const request = (turns: Parameters<typeof prepareChatRequest>[0]['turns']) => ({
  id: 'synthetic-context',
  modelId: 'synthetic-model',
  webSearch: false,
  instructions: 'instructions',
  turns,
});
function attachment(name: string, size = 1) {
  const file = new File(['x'], name);
  // Exercise oversized metadata without allocating hundreds of MiB in the test.
  Object.defineProperty(file, 'size', { value: size });
  const read = vi.spyOn(file, 'arrayBuffer');
  return { value: { name, file }, read };
}

function droppedFolder(batches: File[][]): DataTransfer {
  return {
    items: [
      {
        webkitGetAsEntry: () => ({
          name: 'folder',
          isFile: false,
          createReader() {
            let batch = 0;
            return {
              readEntries(success: (entries: unknown[]) => void) {
                success(
                  (batches[batch++] ?? []).map((file) => ({
                    name: file.name,
                    isFile: true,
                    file: (receive: (file: File) => void) => receive(file),
                  })),
                );
              },
            };
          },
        }),
      },
    ],
    files: [],
  } as unknown as DataTransfer;
}

describe('preparation attachment staging', () => {
  it('allows replacement at the count limit and leaves staged files intact if a batch overflows', () => {
    const files = Array.from(
      { length: CHAT_FILE_LIMIT },
      (_, index) => new File(['original'], `${index}.txt`),
    );
    const existing = stageAttachments([], files);
    const replacement = new File(['replacement'], files[0].name);
    const updated = stageAttachments(existing, [replacement]);
    expect(updated).toHaveLength(CHAT_FILE_LIMIT);
    expect(updated[0].file).toBe(replacement);
    expect(existing[0].file).toBe(files[0]);
    expect(() => stageAttachments(existing, [replacement, new File(['new'], 'extra.txt')])).toThrow(
      '每条消息最多添加 20 个文件。',
    );
    expect(existing.map(({ file }) => file)).toEqual(files);
  });

  it('accepts the exact per-file byte limit and rejects oversized or empty replacements without data loss', () => {
    const exact = attachment('notes.txt', CHAT_FILE_BYTES_LIMIT).value.file;
    const existing = stageAttachments([], [exact]);
    expect(existing[0].size).toBe(CHAT_FILE_BYTES_LIMIT);
    for (const size of [CHAT_FILE_BYTES_LIMIT + 1, 0]) {
      const invalid = attachment(exact.name, size).value.file;
      expect(() => stageAttachments(existing, [invalid])).toThrow('文件需为 1 字节至 20 MB');
    }
    expect(existing[0].file).toBe(exact);
  });

  it('drains directory batches through the exact limit and preserves relative names and file metadata', async () => {
    const files = Array.from(
      { length: CHAT_FILE_LIMIT },
      (_, index) =>
        new File(['x'], `${index}.txt`, { type: 'text/plain', lastModified: index + 1 }),
    );
    const result = await readDroppedFiles(droppedFolder([files.slice(0, 7), files.slice(7)]));
    expect(result.map(({ name }) => name)).toEqual(files.map(({ name }) => `folder/${name}`));
    expect(result.map(({ type, lastModified }) => ({ type, lastModified }))).toEqual(
      files.map(({ type, lastModified }) => ({ type, lastModified })),
    );
    expect(stageAttachments([], result)).toHaveLength(CHAT_FILE_LIMIT);
  });

  it('rejects a directory whose later batch exceeds the attachment count limit', async () => {
    const files = Array.from(
      { length: CHAT_FILE_LIMIT + 1 },
      (_, index) => new File(['x'], `${index}.txt`),
    );
    await expect(
      readDroppedFiles(
        droppedFolder([files.slice(0, CHAT_FILE_LIMIT), files.slice(CHAT_FILE_LIMIT)]),
      ),
    ).rejects.toThrow('每条消息最多添加 20 个文件。');
  });
});

describe('preparation attachment allocation budget', () => {
  it('refuses an oversized complete history before reading any earlier attachment', async () => {
    const first = attachment('first.txt', 20 * 1024 ** 2);
    const second = attachment('second.txt', 20 * 1024 ** 2);
    await expect(
      prepareChatRequest(
        request([
          { role: 'user', content: 'old', files: [first.value] },
          { role: 'assistant', content: 'reply' },
          { role: 'user', content: 'new', files: [second.value] },
        ]),
        new AbortController().signal,
      ),
    ).rejects.toThrow('合计 32 MB');
    expect(first.read).not.toHaveBeenCalled();
    expect(second.read).not.toHaveBeenCalled();
  });

  it('checks count, turn and instruction-inclusive text limits before reading', async () => {
    const item = attachment('small.txt');
    for (const input of [
      request([{ role: 'user', content: '', files: Array(21).fill(item.value) }]),
      request(
        Array.from({ length: CHAT_TURN_LIMIT + 1 }, () => ({
          role: 'user' as const,
          content: '',
          files: [item.value],
        })),
      ),
      request([{ role: 'user', content: 'x'.repeat(CHAT_TEXT_LIMIT), files: [item.value] }]),
    ])
      await expect(prepareChatRequest(input, new AbortController().signal)).rejects.toThrow();
    expect(item.read).not.toHaveBeenCalled();
  });

  it('stops after an in-flight read when cancelled, without starting the next file', async () => {
    const first = attachment('first.txt');
    const second = attachment('second.txt');
    let finish!: (data: ArrayBuffer) => void;
    first.read.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const controller = new AbortController();
    const pending = prepareChatRequest(
      request([{ role: 'user', content: '', files: [first.value, second.value] }]),
      controller.signal,
    );
    expect(first.read).toHaveBeenCalledOnce();
    expect(second.read).not.toHaveBeenCalled();
    controller.abort();
    finish(new ArrayBuffer(1));
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(second.read).not.toHaveBeenCalled();
  });

  it('preserves turn order, names and bytes within the existing budget', async () => {
    const first = attachment('first.txt');
    const second = attachment('second.txt');
    const result = await prepareChatRequest(
      request([
        { role: 'user', content: 'old', files: [first.value] },
        { role: 'assistant', content: 'reply' },
        { role: 'user', content: 'new', files: [second.value] },
      ]),
      new AbortController().signal,
    );
    expect(result.turns).toEqual([
      {
        role: 'user',
        content: 'old',
        files: [{ name: 'first.txt', bytes: new Uint8Array([120]) }],
      },
      { role: 'assistant', content: 'reply', files: undefined },
      {
        role: 'user',
        content: 'new',
        files: [{ name: 'second.txt', bytes: new Uint8Array([120]) }],
      },
    ]);
    expect(first.read).toHaveBeenCalledOnce();
    expect(second.read).toHaveBeenCalledOnce();
  });
});

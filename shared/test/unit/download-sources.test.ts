import { describe, expect, it, vi } from 'vitest';
import {
  downloadUrl,
  readPublicText,
  regionLookup,
  resolveDownloadSource,
} from '../../electron/backend/downloads';

describe('匿名下载源分流', () => {
  it.each([
    ['CN', 'cnb'],
    ['HK', 'github'],
    ['MO', 'github'],
    ['TW', 'github'],
    ['GB', 'github'],
  ])('按出口国家 %s 选择 %s，CDN 节点和界面语言不参与', async (country, source) => {
    const fetcher = vi.fn(async (input, init) => {
      expect(String(input)).toBe(regionLookup);
      expect(init).toMatchObject({ credentials: 'omit', cache: 'no-store' });
      return new Response(`colo=CTU\nloc=${country}\n`);
    }) as typeof fetch;
    expect(await resolveDownloadSource(fetcher, new AbortController().signal)).toBe(source);
  });
  it('查询失败、重复国家和异常响应沿用 GitHub；用户取消不能继续下载', async () => {
    for (const fetcher of [
      async () => {
        throw Error('offline');
      },
      async () => new Response('loc=CN\nloc=GB'),
      async () => new Response('loc=CN', { status: 403 }),
      async () => new Response('x'.repeat(4097)),
    ])
      expect(
        await resolveDownloadSource(fetcher as typeof fetch, new AbortController().signal),
      ).toBe('github');
    const controller = new AbortController();
    controller.abort();
    const fetcher = vi.fn();
    await expect(resolveDownloadSource(fetcher, controller.signal)).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('区域查询三秒截止，停滞响应取消而不阻塞更新', async () => {
    const cancelled = vi.fn();
    const start = performance.now();
    expect(
      await resolveDownloadSource(
        async () => new Response(new ReadableStream({ cancel: cancelled })),
        new AbortController().signal,
      ),
    ).toBe('github');
    expect(performance.now() - start).toBeLessThan(4500);
    expect(cancelled).toHaveBeenCalledOnce();
  });
  it('地址只从固定仓库和合法单段文件名生成，拒绝注入', () => {
    expect(downloadUrl('cnb', 'v1.3.3', 'VoxCue-Setup-1.3.3-x64.exe').origin).toBe(
      'https://cnb.cool',
    );
    for (const name of ['../payload.exe', 'https://evil.test/a', 'a?token=b', 'a#b', 'a\\b'])
      expect(() => downloadUrl('github', 'v1.3.3', name)).toThrow();
    expect(() => downloadUrl('evil' as any, 'v1.3.3', 'latest.yml')).toThrow();
  });
  it('超限元数据取消读取，不等待无法完成的传输清理', async () => {
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    const response = new Response(
      new ReadableStream({ start: (controller) => controller.enqueue(new Uint8Array(20)), cancel }),
    );
    await expect(
      readPublicText(async () => response, new URL(regionLookup), new AbortController().signal, 10),
    ).rejects.toThrow('exceeded');
    expect(cancel).toHaveBeenCalledOnce();
  });
});

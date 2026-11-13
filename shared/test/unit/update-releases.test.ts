import { describe, expect, it, vi } from 'vitest';
import {
  releaseTarget,
  latestPlatformRelease,
  releaseCandidates,
  manifestFile,
  compareVersions,
  releasePageLimit,
  type ReleaseTarget,
} from '../../../shared/electron/backend/updates/releases';
import {
  platformReleaseProvider,
  type ReleaseFetch,
} from '../../../shared/electron/backend/updates/provider';

const checksum = Buffer.alloc(64, 7).toString('base64');
function release(
  version: string,
  target: ReleaseTarget = 'windows-x64',
  extra: Record<string, unknown> = {},
) {
  const binary =
    target === 'windows-x64' ? `VoxCue-Setup-${version}-x64.exe` : `VoxCue-${version}-arm64.zip`;
  const manifest = target === 'windows-x64' ? 'latest.yml' : 'latest-mac.yml';
  return {
    draft: false,
    prerelease: false,
    published_at: '2026-10-15T01:00:00Z',
    tag_name: `${target}-v${version}`,
    assets: [
      { name: manifest, size: 350, state: 'uploaded' },
      { name: binary, size: 100, state: 'uploaded' },
      ...(target === 'windows-x64'
        ? [{ name: binary + '.blockmap', size: 10, state: 'uploaded' }]
        : []),
    ],
    ...extra,
  };
}
function manifest(version = '0.1.2', target: ReleaseTarget = 'windows-x64') {
  return {
    version,
    files: [
      {
        url:
          target === 'windows-x64'
            ? `VoxCue-Setup-${version}-x64.exe`
            : `VoxCue-${version}-arm64.zip`,
        size: 100,
        sha512: checksum,
      },
    ],
  };
}
function provider(
  target: ReleaseTarget,
  fetcher: ReleaseFetch,
  controller = new AbortController(),
) {
  const Provider = platformReleaseProvider(target, controller.signal, fetcher);
  return {
    controller,
    instance: new Provider({}, {} as any, {
      platform: target === 'windows-x64' ? 'win32' : 'darwin',
      executor: {} as any,
      isUseMultipleRangeRequest: false,
    }),
  };
}

describe('按平台独立选择正式更新', () => {
  it('仅支持Windows x64与Mac原生arm64，拒绝Intel Mac/其他架构', () => {
    expect(releaseTarget('win32', 'x64')).toBe('windows-x64');
    expect(releaseTarget('darwin', 'arm64')).toBe('macos-arm64');
    for (const pair of [
      ['darwin', 'x64'],
      ['win32', 'arm64'],
      ['linux', 'arm64'],
    ])
      expect(releaseTarget(...(pair as [string, string]))).toBeUndefined();
  });
  it('忽略统一Latest、时间及列表顺序，数字排序并分别选择不同平台版本', async () => {
    const page = [
      release('9.0.0', 'macos-arm64', { name: 'Latest' }),
      release('0.1.9'),
      release('0.1.10', 'windows-x64', { published_at: '2025-01-01T00:00:00Z' }),
      release('0.1.8', 'windows-x64', { published_at: '2027-01-01T00:00:00Z' }),
    ];
    expect((await latestPlatformRelease('windows-x64', async () => page)).version).toBe('0.1.10');
    expect((await latestPlatformRelease('macos-arm64', async () => page)).version).toBe('9.0.0');
    expect(compareVersions('0.1.10', '0.1.9')).toBe(1);
  });
  it('草稿、预发布、未发布、残缺上传、其他产品与Intel/Universal Mac包不候选', () => {
    const valid = release('0.1.2');
    const cases = [
      release('99.0.0', 'windows-x64', { draft: true }),
      release('99.0.1', 'windows-x64', { prerelease: true }),
      release('99.0.2', 'windows-x64', { published_at: null }),
      release('99.0.3-beta.1'),
      { ...valid, assets: valid.assets.slice(1) },
      { ...valid, assets: valid.assets.slice(0, 2) },
      { ...valid, assets: valid.assets.map((asset) => ({ ...asset, state: 'new' })) },
      {
        ...valid,
        assets: valid.assets.map((asset) => ({
          ...asset,
          name: asset.name.replace('VoxCue', 'Other'),
        })),
      },
      release('0.1.2', 'macos-arm64'),
    ];
    expect(releaseCandidates(cases, 'windows-x64')).toEqual([]);
    const mac = release('0.1.2', 'macos-arm64');
    for (const arch of ['x64', 'universal'])
      expect(
        releaseCandidates(
          [
            {
              ...mac,
              assets: mac.assets.map((asset) => ({
                ...asset,
                name: asset.name.replace('arm64', arch),
              })),
            },
          ],
          'macos-arm64',
        ),
      ).toEqual([]);
  });
  it('分页扫描不漏后续更高版本；分页失败或上限不伪称旧版最新', async () => {
    const read = vi.fn(async (page: number) =>
      page === 1 ? Array.from({ length: 100 }, () => release('0.1.2')) : [release('0.2.0')],
    );
    expect((await latestPlatformRelease('windows-x64', read)).version).toBe('0.2.0');
    expect(read.mock.calls).toEqual([[1], [2]]);
    await expect(
      latestPlatformRelease('windows-x64', async (page) => {
        if (page === 2) throw Error('rate limited');
        return Array.from({ length: 100 }, () => release('0.1.2'));
      }),
    ).rejects.toThrow('rate limited');
    const full = vi.fn(async () => Array.from({ length: 100 }, () => release('0.1.2')));
    await expect(latestPlatformRelease('windows-x64', full)).rejects.toThrow('pagination limit');
    expect(full).toHaveBeenCalledTimes(releasePageLimit);
  });
  it('没有当前平台正式包或索引结构损坏时明确失败', async () => {
    await expect(
      latestPlatformRelease('windows-x64', async () => [release('0.1.2', 'macos-arm64')]),
    ).rejects.toThrow('No complete stable release');
    expect(() => releaseCandidates({ releases: [] }, 'windows-x64')).toThrow();
    expect(() => compareVersions('1.2.3-beta.1', '1.2.3')).toThrow();
    expect(() => compareVersions('01.2.3', '1.2.3')).toThrow();
  });
  it('清单版本、架构文件、摘要与大小必须对应所选发行；额外URL/安装包字段不投影', () => {
    const candidate = releaseCandidates([release('0.1.2')], 'windows-x64')[0];
    const info = manifest();
    expect(
      manifestFile(
        { ...info, packages: { x64: { path: 'https://evil.test/payload' } } },
        candidate,
      ),
    ).toEqual({ ...info.files[0], minimumSystemVersion: undefined });
    for (const bad of [
      { ...info, version: '0.1.3' },
      { ...info, files: [{ ...info.files[0], url: 'https://evil.test/update.exe' }] },
      { ...info, files: [{ ...info.files[0], url: '../' + info.files[0].url }] },
      { ...info, files: [{ ...info.files[0], url: info.files[0].url.replace('x64', 'arm64') }] },
      { ...info, files: [{ ...info.files[0], sha512: 'invalid' }] },
      { ...info, files: [{ ...info.files[0], size: 101 }] },
      { ...info, files: [info.files[0], info.files[0]] },
    ])
      expect(() => manifestFile(bad, candidate)).toThrow();
  });
  it.each(['windows-x64', 'macos-arm64'] as const)(
    '%s 使用真实YAML解析/Provider接口且不访问Latest端点',
    async (target) => {
      const requests: string[] = [];
      const fetcher: ReleaseFetch = async (input, init) => {
        const url = new URL(String(input));
        requests.push(url.href);
        expect(init?.credentials).toBe('omit');
        if (url.hostname === 'api.github.com')
          return new Response(
            JSON.stringify([
              release('9.9.9', target === 'windows-x64' ? 'macos-arm64' : 'windows-x64'),
              release('0.1.2', target),
            ]),
          );
        return new Response(
          JSON.stringify({
            ...manifest('0.1.2', target),
            packages: { x64: { path: 'https://evil.test/other' } },
          }),
        );
      };
      const { instance } = provider(target, fetcher);
      const info = await instance.getLatestVersion();
      expect(info.version).toBe('0.1.2');
      expect(info).not.toHaveProperty('packages');
      const files = instance.resolveFiles(info);
      expect(files).toHaveLength(1);
      expect(files[0].url.href).toBe(
        `https://github.com/NCFXZ/VoxCue/releases/download/${target}-v0.1.2/${info.files[0].url}`,
      );
      expect(requests).toEqual([
        'https://api.github.com/repos/NCFXZ/VoxCue/releases?per_page=100&page=1',
        `https://github.com/NCFXZ/VoxCue/releases/download/${target}-v0.1.2/${target === 'windows-x64' ? 'latest.yml' : 'latest-mac.yml'}`,
      ]);
      expect(requests.some((url) => url.endsWith('/latest') || url.includes('.atom'))).toBe(false);
    },
  );
  it('最新版清单损坏不回退旧版；HTTP失败和超限响应均拒绝', async () => {
    const pages = JSON.stringify([release('0.1.2'), release('0.1.3')]);
    for (const response of [
      () => new Response(JSON.stringify(manifest('0.1.2'))),
      () => new Response('rate limited', { status: 403 }),
      () => new Response('x'.repeat(128 * 1024 + 1)),
    ]) {
      const { instance } = provider('windows-x64', async (input) =>
        new URL(String(input)).hostname === 'api.github.com' ? new Response(pages) : response(),
      );
      await expect(instance.getLatestVersion()).rejects.toThrow();
    }
  });
  it('退出取消挂起的清单读取，迟到数据不得返回成功', async () => {
    let manifestStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      manifestStarted = resolve;
    });
    const cancelled = vi.fn();
    const fixture = provider('windows-x64', async (input) => {
      if (new URL(String(input)).hostname === 'api.github.com')
        return new Response(JSON.stringify([release('0.1.2')]));
      manifestStarted();
      return new Response(new ReadableStream({ cancel: cancelled }));
    });
    const pending = fixture.instance.getLatestVersion();
    await started;
    await vi.waitFor(() => expect(cancelled).not.toHaveBeenCalled());
    fixture.controller.abort();
    await expect(pending).rejects.toThrow();
    expect(cancelled).toHaveBeenCalled();
  });
  it.each(['http', 'size'] as const)('拒绝 %s 响应不等待永不完成的传输取消', async (failure) => {
    const cancelled = vi.fn(() => new Promise<void>(() => {}));
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          if (failure === 'size') controller.enqueue(new Uint8Array(128 * 1024 + 1));
        },
        cancel: cancelled,
      }),
      { status: failure === 'http' ? 403 : 200 },
    );
    const fixture = provider('windows-x64', async (input) =>
      new URL(String(input)).hostname === 'api.github.com'
        ? new Response(JSON.stringify([release('0.1.2')]))
        : response,
    );
    await expect(fixture.instance.getLatestVersion()).rejects.toThrow(
      failure === 'http' ? 'Release request failed' : 'exceeded size limit',
    );
    expect(cancelled).toHaveBeenCalledOnce();
    expect(response.body!.locked).toBe(false);
  });
});

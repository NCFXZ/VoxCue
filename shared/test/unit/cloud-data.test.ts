import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import {
  applyCloudItem,
  cloudFileParent,
  digestCloudBlob,
  localCloudItems,
  packCloudItem,
} from '../../src/services/cloudData';
import {
  localKnowledge,
  documentRevision,
  restoreSyncedDocument,
} from '../../src/services/knowledge';

const profileKey = 'copilot-personal-info-v1';
describe('cloud data restoration boundary', () => {
  let values: Map<string, string>;
  beforeEach(() => {
    values = new Map();
    vi.stubGlobal('indexedDB', new IDBFactory());
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => values.get(k) ?? null,
      setItem: (k: string, v: string) => values.set(k, v),
    });
    vi.stubGlobal('window', { dispatchEvent: () => true });
  });
  afterEach(() => vi.unstubAllGlobals());
  it('a late profile download cannot overwrite a newer JD or commit after logout', async () => {
    const original = { name: 'synthetic', jobDescription: 'old JD', background: '' };
    values.set(profileKey, JSON.stringify(original));
    const hash = await digestCloudBlob(await (await localCloudItems('profile'))[0].blob());
    const remote = packCloudItem(
      'profile:main',
      JSON.stringify({ ...original, jobDescription: 'remote JD' }),
    );
    values.set(profileKey, JSON.stringify({ ...original, jobDescription: 'new local JD' }));
    await expect(applyCloudItem('profile:main', remote, hash)).rejects.toThrow('本地数据已有修改');
    expect(JSON.parse(values.get(profileKey)!).jobDescription).toBe('new local JD');
    const current = await digestCloudBlob(await (await localCloudItems('profile'))[0].blob());
    await expect(
      applyCloudItem('profile:main', remote, current, undefined, () => {
        throw Error('logout');
      }),
    ).rejects.toThrow('logout');
    expect(JSON.parse(values.get(profileKey)!).jobDescription).toBe('new local JD');
  });
  it('a file replacement races safely with restoration and local-only revision fields never enter the cloud package', async () => {
    await localKnowledge.saveBase({ id: 'base', name: 'Synthetic', createdAt: 1 });
    await localKnowledge.importDocuments('base', [new File(['old'], 'original.txt')]);
    const old = (await localKnowledge.listDocuments('base'))[0];
    await localKnowledge.importDocuments('base', [new File(['new local'], 'original.txt')]);
    await expect(
      restoreSyncedDocument({ ...old, blob: new Blob(['remote']), size: 6 }, documentRevision(old)),
    ).rejects.toThrow();
    const current = (await localKnowledge.listDocuments('base'))[0];
    expect(await current.blob.text()).toBe('new local');
    const item = (await localCloudItems('knowledgebase')).find((i) => i.key.startsWith('file:'))!;
    const content = await item.blob();
    expect((await content.text()).includes('localRevision')).toBe(false);
    expect((await content.text()).includes(current.localRevision!)).toBe(false);
  });
  it('malicious file names, oversized declared metadata and wrong-category payloads cannot be restored', async () => {
    const metadata = {
      id: 'doc',
      baseId: 'base',
      name: '../../credentials.txt',
      size: 1,
      type: 'text/plain',
      createdAt: 1,
    };
    await expect(
      applyCloudItem('file:doc', packCloudItem('file:doc', new Uint8Array([1]), metadata)),
    ).rejects.toThrow('元数据');
    await expect(
      applyCloudItem(
        'profile:main',
        packCloudItem('profile:main', '{"name":"x","jobDescription":42}'),
      ),
    ).rejects.toThrow('个人信息');
    expect(values.get(profileKey)).toBeUndefined();
  });
  it('restored originals are returned for indexing without emitting a local edit', async () => {
    const events: string[] = [];
    vi.stubGlobal('window', {
      dispatchEvent: (event: Event) => {
        events.push(event.type);
        return true;
      },
    });
    await applyCloudItem(
      'base:base',
      packCloudItem('base:base', JSON.stringify({ id: 'base', name: 'Synthetic', createdAt: 1 })),
    );
    const metadata = {
      id: 'doc',
      baseId: 'base',
      name: 'remote.txt',
      size: 7,
      type: 'text/plain',
      createdAt: 1,
    };
    const document = await applyCloudItem(
      'file:doc',
      packCloudItem('file:doc', 'content', metadata),
    );
    expect(document).toMatchObject(metadata);
    expect(await document!.blob.text()).toBe('content');
    const [committed] = await localKnowledge.listDocuments('base');
    expect(await committed.blob.text()).toBe('content');
    expect(document!.localRevision).toBe(committed.localRevision);
    expect(events).toEqual(['voxcue-sync-applied', 'voxcue-sync-applied']);
    await localKnowledge.saveBase({ id: 'base', name: 'Local edit', createdAt: 1 });
    expect(events.at(-1)).toBe('voxcue-local-change');
  });
  it('cold file ownership rejects mismatched identities, invalid parents and resume ownership', async () => {
    expect(
      await cloudFileParent(
        'file:doc',
        packCloudItem('file:doc', 'x', {
          id: 'doc',
          baseId: 'base',
        }),
      ),
    ).toBe('base:base');
    for (const metadata of [
      { id: 'other', baseId: 'base' },
      { id: 'doc', baseId: '../base' },
      { id: 'doc', baseId: 'personal-resume' },
      { id: 'doc', baseId: '' },
    ])
      await expect(
        cloudFileParent('file:doc', packCloudItem('file:doc', 'x', metadata)),
      ).rejects.toThrow();
    await expect(
      cloudFileParent(
        'file:doc',
        packCloudItem('file:other', 'x', {
          id: 'doc',
          baseId: 'base',
        }),
      ),
    ).rejects.toThrow('归属');
  });

  it('a cancelled file restore returns no document or applied event and preserves committed bytes', async () => {
    await localKnowledge.saveBase({ id: 'base', name: 'Synthetic', createdAt: 1 });
    await localKnowledge.importDocuments('base', [new File(['original'], 'original.txt')]);
    const [original] = await localKnowledge.listDocuments('base');
    const item = (await localCloudItems('knowledgebase')).find(
      (i) => i.key === 'file:' + original.id,
    )!;
    const hash = await digestCloudBlob(await item.blob());
    const events = vi.fn();
    vi.stubGlobal('window', { dispatchEvent: events });
    await expect(
      applyCloudItem(
        item.key,
        packCloudItem(item.key, 'remote', {
          id: original.id,
          baseId: 'base',
          name: original.name,
          size: 6,
          type: 'text/plain',
          createdAt: 1,
        }),
        hash,
        undefined,
        () => {
          throw Error('synthetic account switch');
        },
      ),
    ).rejects.toThrow('synthetic account switch');
    expect(events).not.toHaveBeenCalled();
    const [saved] = await localKnowledge.listDocuments('base');
    expect(saved.localRevision).toBe(original.localRevision);
    expect(await saved.blob.text()).toBe('original');
  });
});

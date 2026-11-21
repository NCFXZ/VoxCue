import type { CloudResource } from '../../electron/contracts/cloudSync';
import { decodeCloudItem, type LocalSyncItem } from './cloudData';

/** Only retain references and titles for verified cloud heads, never the record body. */
export class HistorySyncGroups {
  private heads = new Map<string, { head: string; images: string[]; title?: string }>();
  private local = new Map<string, Set<string>>();
  private cloud = new Map<string, Set<string>>();

  async refresh(keys: Set<string>, sources: Map<string, LocalSyncItem>, remote: Map<string, CloudResource>,
    pending: Record<string, Record<string, string | null>> | undefined, hash: (source: LocalSyncItem) => Promise<string | undefined>,
    read: (resource: CloudResource) => Promise<Blob>) {
    const local = new Map<string, Set<string>>(), cloud = new Map<string, Set<string>>();
    const members = new Map<string, Set<string>>();
    const imagesPresent = [...keys].some(key => key.startsWith('image:')) ||
      [...sources.values()].some(source => source.kind === 'history' && source.dependencies?.length);
    const add = (owners: Map<string, Set<string>>, key: string, image: string) => {
      if (!owners.has(image)) owners.set(image, new Set());
      owners.get(image)!.add(key);
      members.get(key)!.add(image);
    };
    for (const key of this.heads.keys()) if (!remote.has(key)) this.heads.delete(key);
    for (const key of keys) {
      if (!key.startsWith('record:')) continue;
      members.set(key, new Set([key, ...Object.keys(pending?.[key] ?? {})]));
      const source = sources.get(key), resource = remote.get(key);
      for (const image of source?.dependencies ?? []) add(local, key, image);
      if (!resource?.headVersion || !imagesPresent) continue;
      let cached = this.heads.get(key);
      if (cached?.head !== resource.headVersion) {
        if (source && await hash(source) === resource.sha256) {
          cached = { head: resource.headVersion, images: source.dependencies ?? [] };
        } else {
          const result = await decodeCloudItem(key, await read(resource));
          if (result.type !== 'record') throw Error('云端面试记录无效。');
          cached = { head: resource.headVersion, images: result.images.map(id => 'image:' + id), title: result.record.title };
        }
        this.heads.set(key, cached);
      }
      for (const image of cached.images) add(cloud, key, image);
    }
    this.local = local;
    this.cloud = cloud;
    return members;
  }
  owners(key: string, side: 'local' | 'cloud') {
    return this[side].get(key);
  }
  title(root: string, head: string | null | undefined) {
    const entry = this.heads.get(root);
    return entry && entry.head === head ? entry.title : undefined;
  }
}

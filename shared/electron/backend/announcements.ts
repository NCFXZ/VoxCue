import { announcementApplies, parseAnnouncementFeed, type Announcement, type AnnouncementsResult } from '../contracts/announcements';
import { versionParts } from '../contracts/versions';
import { boundedJson } from './boundedJson';
import { abortable } from './cancellable';

export const announcementsUrl = 'https://voxcue.com.cn/app/announcements.json';
const cacheLifetime = 10 * 60_000;

export class AnnouncementService {
  private cache?: { items: Announcement[]; checkedAt: number };
  private job?: Promise<Announcement[]>;
  private readonly lifetime = new AbortController();
  constructor(private readonly version: string, private readonly fetcher: typeof fetch = fetch) {
    versionParts(version);
  }

  private load(): Promise<Announcement[]> {
    if (this.cache && Date.now() - this.cache.checkedAt < cacheLifetime) return Promise.resolve(this.cache.items);
    if (this.job) return this.job;
    const signal = AbortSignal.any([this.lifetime.signal, AbortSignal.timeout(8000)]);
    const request = (async () => {
      const response = await abortable(this.fetcher(announcementsUrl, {
        signal, redirect: 'error', credentials: 'omit', headers: { Accept: 'application/json' }, cache: 'no-store',
      }), signal);
      if (!response.ok || !/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')) {
        void response.body?.cancel().catch(() => {});
        throw Error('Announcement feed unavailable');
      }
      const items = parseAnnouncementFeed(await boundedJson(response, 64 * 1024, signal));
      signal.throwIfAborted();
      this.cache = { items, checkedAt: Date.now() };
      return items;
    })();
    this.job = request;
    void request.finally(() => { if (this.job === request) this.job = undefined; }).catch(() => {});
    return request;
  }

  async read(signedIn: boolean): Promise<AnnouncementsResult> {
    try {
      this.lifetime.signal.throwIfAborted();
      const items = await this.load();
      this.lifetime.signal.throwIfAborted();
      return { ok: true, announcements: items.filter(item => announcementApplies(item, this.version, signedIn, Date.now())) };
    } catch {
      return { ok: false, error: '无法读取公告，请稍后重试。' };
    }
  }

  dispose() { this.lifetime.abort(); this.cache = undefined; }
}

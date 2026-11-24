import { create } from 'zustand';
import { isAnnouncementId, type Announcement } from '../../electron/contracts/announcements';
import { readAnnouncements } from '../services/announcements';

const preferenceKey = 'voxcue-announcement-dismissals-v1';
const maximumPreference = 256 * 1024;
interface AnnouncementStore {
  items: Announcement[];
  error: string | null;
  connect(): () => void;
  refresh(): Promise<void>;
  dismiss(id: string, forever?: boolean): void;
}

export const useAnnouncements = create<AnnouncementStore>((set, get) => {
  let active = false, generation = 0;
  let available: Announcement[] = [];
  let counts = new Map<string, number>();
  const dismissed = new Set<string>();
  let job: Promise<void> | undefined;
  let expiryTimer: ReturnType<typeof setTimeout> | undefined;
  function publish() {
    clearTimeout(expiryTimer);
    const items = available.filter(item => item.expiresAt > Date.now() &&
      !dismissed.has(item.id) && (counts.get(item.id) ?? 0) < 3);
    set({ items });
    if (items.length) expiryTimer = setTimeout(publish,
      Math.min(2_147_483_647, Math.max(1, Math.min(...items.map(item => item.expiresAt)) - Date.now())));
  }
  return {
    items: [], error: null,
    connect() {
      const owner = ++generation;
      active = true;
      available = [];
      counts = new Map();
      dismissed.clear();
      try {
        const raw = localStorage.getItem(preferenceKey);
        const value: unknown = raw && raw.length <= maximumPreference ? JSON.parse(raw) : null;
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          for (const [id, count] of Object.entries(value))
            if (isAnnouncementId(id) && Number.isInteger(count) && count >= 1 && count <= 3) counts.set(id, count);
        }
      } catch { /* Damaged optional preferences do not block application startup. */ }
      set({ items: [], error: null });
      void get().refresh();
      const refresh = () => { void get().refresh(); };
      window.addEventListener('focus', refresh);
      const poll = setInterval(refresh, 10 * 60_000);
      return () => {
        if (generation !== owner) return;
        active = false;
        ++generation;
        job = undefined;
        clearTimeout(expiryTimer);
        clearInterval(poll);
        window.removeEventListener('focus', refresh);
        set({ items: [], error: null });
      };
    },
    refresh() {
      if (!active) return Promise.resolve();
      if (job) return job;
      const owner = generation;
      const request = (async () => {
        try {
          const result = await readAnnouncements();
          if (!active || generation !== owner) return;
          available = result.ok ? result.announcements : [];
          set({ error: result.ok ? null : result.error });
          publish();
        } catch {
          if (!active || generation !== owner) return;
          available = [];
          set({ error: '无法读取公告，请稍后重试。' });
          publish();
        }
      })();
      job = request;
      void request.finally(() => { if (job === request) job = undefined; });
      return request;
    },
    dismiss(id, forever = false) {
      if (!active || !get().items.some(item => item.id === id)) return;
      const next = new Map(counts);
      next.set(id, forever ? 3 : Math.min(3, (counts.get(id) ?? 0) + 1));
      try {
        const raw = JSON.stringify(Object.fromEntries(next));
        if (raw.length > maximumPreference) throw Error('Announcement preferences full');
        localStorage.setItem(preferenceKey, raw);
        counts = next;
        dismissed.add(id);
        set({ error: null });
        publish();
      } catch { set({ error: '无法保存公告设置，请重试。' }); }
    },
  };
});

import type { UILanguage } from './uiLanguage';
import { compareVersions, versionParts } from './versions';

export type AnnouncementText = string | Record<UILanguage, string>;
export type AnnouncementVersion = { type: 'all' } | { type: 'lt' | 'gt' | 'eq'; version: string };
export type AnnouncementAudience = 'all' | 'signed-in' | 'signed-out';
const targets = ['account', 'ai', 'components', 'interview', 'general', 'shortcuts', 'speech-model', 'audio-devices', 'personal-info', 'about'] as const;
export type AnnouncementTarget = typeof targets[number];
const icons = ['external-link', 'settings', 'document', 'list', 'download', 'none'] as const;
export type AnnouncementIcon = typeof icons[number];
export type AnnouncementAction =
  | { type: 'url'; url: AnnouncementText }
  | { type: 'navigate'; target: AnnouncementTarget };
export interface Announcement {
  id: string;
  title: AnnouncementText;
  subtitle: AnnouncementText;
  expiresAt: number;
  audience: AnnouncementAudience;
  versionFilter: AnnouncementVersion;
  button?: { label: AnnouncementText; icon?: AnnouncementIcon; action: AnnouncementAction };
}
export type AnnouncementsResult = { ok: true; announcements: Announcement[] } | { ok: false; error: string };

export const announcementText = (value: AnnouncementText, language: UILanguage) =>
  typeof value === 'string' ? value : value[language];
export const isAnnouncementId = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(value);

const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
function fields(value: unknown, keys: string[]): asserts value is Record<string, unknown> {
  if (!record(value) || Object.keys(value).some(key => !keys.includes(key))) throw Error('Invalid announcement fields');
}
function text(value: unknown, maximum: number, empty = false): AnnouncementText {
  const valid = (part: unknown): part is string =>
    typeof part === 'string' && part.length <= maximum && (empty || !!part.trim());
  if (valid(value)) return value;
  fields(value, ['zh-CN', 'en']);
  if (Object.keys(value).length !== 2 || !valid(value['zh-CN']) || !valid(value.en)) throw Error('Missing announcement translation');
  return { 'zh-CN': value['zh-CN'], en: value.en };
}
function webUrl(value: unknown): string {
  if (typeof value !== 'string' || value.length > 2048) throw Error('Invalid announcement URL');
  const url = new URL(value);
  if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) throw Error('Invalid announcement URL');
  return url.href;
}

export function parseAnnouncementFeed(value: unknown): Announcement[] {
  fields(value, ['schemaVersion', 'announcements']);
  if (value.schemaVersion !== 1 || !Array.isArray(value.announcements) || value.announcements.length > 20)
    throw Error('Invalid announcement feed');
  const ids = new Set<string>();
  return value.announcements.map((item): Announcement => {
    fields(item, ['id', 'title', 'subtitle', 'expiresAt', 'audience', 'versionFilter', 'button']);
    if (!isAnnouncementId(item.id) || ids.has(item.id)) throw Error('Invalid or duplicate announcement ID');
    ids.add(item.id);
    if (typeof item.expiresAt !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(item.expiresAt) ||
        !Number.isFinite(Date.parse(item.expiresAt))) throw Error('Invalid announcement expiry');
    const audience = item.audience === undefined ? 'all' : item.audience;
    if (!['all', 'signed-in', 'signed-out'].includes(audience as string)) throw Error('Invalid announcement audience');
    const filter = item.versionFilter === undefined ? { type: 'all' } : item.versionFilter;
    fields(filter, ['type', 'version']);
    if (!['all', 'lt', 'gt', 'eq'].includes(filter.type as string) ||
        (filter.type === 'all' ? Object.hasOwn(filter, 'version') : typeof filter.version !== 'string'))
      throw Error('Invalid announcement version filter');
    if (filter.type !== 'all') versionParts(filter.version as string);
    let button: Announcement['button'];
    if (item.button !== undefined) {
      fields(item.button, ['label', 'icon', 'action']);
      if (item.button.icon !== undefined && !icons.includes(item.button.icon as AnnouncementIcon)) throw Error('Invalid announcement icon');
      const action = item.button.action;
      fields(action, ['type', 'url', 'target']);
      if (action.type === 'url' && !Object.hasOwn(action, 'target')) {
        const urls = text(action.url, 2048);
        button = { label: text(item.button.label, 40), action: { type: 'url', url: typeof urls === 'string'
          ? webUrl(urls) : { 'zh-CN': webUrl(urls['zh-CN']), en: webUrl(urls.en) } } };
      } else if (action.type === 'navigate' && !Object.hasOwn(action, 'url') &&
          targets.includes(action.target as AnnouncementTarget)) {
        button = { label: text(item.button.label, 40), action: { type: 'navigate', target: action.target as AnnouncementTarget } };
      } else throw Error('Invalid announcement action');
      if (item.button.icon !== undefined) button.icon = item.button.icon as AnnouncementIcon;
    }
    return {
      id: item.id, title: text(item.title, 120), subtitle: text(item.subtitle, 600, true),
      expiresAt: Date.parse(item.expiresAt), audience: audience as AnnouncementAudience,
      versionFilter: filter as AnnouncementVersion, ...(button ? { button } : {}),
    };
  });
}

export function announcementApplies(item: Announcement, version: string, signedIn: boolean, now: number) {
  if (item.expiresAt <= now || (item.audience === 'signed-in' && !signedIn) ||
      (item.audience === 'signed-out' && signedIn)) return false;
  const filter = item.versionFilter;
  if (filter.type === 'all') return true;
  const order = compareVersions(version, filter.version);
  return filter.type === 'lt' ? order < 0 : filter.type === 'gt' ? order > 0 : order === 0;
}

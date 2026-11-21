import { profileFields, validProfile, type PersonalInfo } from '../../electron/contracts/profile';
import { validRestoreKey, packCloudItem } from '../../electron/contracts/restoreData';
import { decodeCloudItem, digestCloudBlob } from './cloudData';
import { hasSavedProfile, readStoredProfile } from './storedValues';

type Field = keyof PersonalInfo;
const fields: readonly Field[] = [...profileFields, 'role'];
const emptyProfile = (): PersonalInfo => ({ name: '', jobDescription: '', background: '' });
const storageKey = (owner: string) => 'voxcue-moved-from-device-v1:' + owner.replace(/^account:/, '');
const validDigest = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
type ProfileHashes = { remote: string; local: string };

/** The source partition stores item IDs and one-way sync hashes, never the removed content. */
export function movedCloudItems(owner: string) {
  const key = storageKey(owner);
  const raw = localStorage.getItem(key);
  const data = raw === null ? { keys: [], fields: [] } : JSON.parse(raw);
  if (!Array.isArray(data.keys) || !data.keys.every(validRestoreKey) ||
      !Array.isArray(data.fields) || !data.fields.every((field: Field) => fields.includes(field)) ||
      (data.profileHashes !== undefined && (!validDigest(data.profileHashes?.remote) || !validDigest(data.profileHashes?.local))))
    throw Error('本机迁移记录无效，请检查本地资料。');
  const keys = new Set<string>(data.keys);
  const hiddenFields = new Set<Field>(data.fields);
  let profileHashes: ProfileHashes | undefined = data.profileHashes;
  function save(next = profileHashes) {
    if (keys.size || hiddenFields.size)
      localStorage.setItem(key, JSON.stringify({
        keys: [...keys], fields: [...hiddenFields],
        ...(hiddenFields.size && next ? { profileHashes: next } : {}),
      }));
    else localStorage.removeItem(key);
    profileHashes = next;
  }
  return {
    keys, fields: hiddenFields, save,
    getProfileHashes: () => profileHashes,
    rememberProfile(remote: string, local: string) {
      if (!hiddenFields.size || (profileHashes?.remote === remote && profileHashes.local === local)) return;
      save({ remote, local });
    },
  };
}

/** Match the exact cloud wire representation, including normalization of older profiles. */
export function movedProfileHash(raw: string) {
  return digestCloudBlob(packCloudItem('profile:main', JSON.stringify(readStoredProfile(raw))));
}

export function recordMovedCloudItems(owner: string, keys: readonly string[], removedFields: readonly Field[],
  change?: { before: string; after: string }) {
  if (keys.some((key) => !validRestoreKey(key)) || removedFields.some((field) => !fields.includes(field)))
    throw Error('迁移资料无效。');
  const key = storageKey(owner);
  const previous = localStorage.getItem(key);
  const moved = movedCloudItems(owner);
  for (const key of keys) moved.keys.add(key);
  for (const field of removedFields) moved.fields.add(field);
  let hashes = moved.getProfileHashes();
  if (change && removedFields.length) {
    const remote = hashes?.local === change.before ? hashes.remote : change.before;
    hashes = { remote, local: change.after };
  }
  moved.save(hashes);
  return () => {
    if (previous === null) localStorage.removeItem(key);
    else localStorage.setItem(key, previous);
  };
}

async function decodeProfile(blob: Blob) {
  const item = await decodeCloudItem('profile:main', blob);
  if (item.type !== 'profile') throw Error('云端个人信息无效。');
  return item.profile;
}

/** The cloud stores one profile document. Merge visible edits into that document
 * on upload, and strip moved fields from downloads before applying them locally. */
export async function projectMovedProfile(localBlob: Blob | undefined, cloudBlob: Blob, hidden: ReadonlySet<Field>) {
  const cloud = await decodeProfile(cloudBlob);
  const local = localBlob ? await decodeProfile(localBlob) : emptyProfile();
  const upload = { ...cloud }, download = { ...cloud };
  const required = emptyProfile();
  const restored: Field[] = [];
  for (const field of fields) {
    const value = local[field];
    if (hidden.has(field) && !value?.length) {
      if (Object.hasOwn(required, field)) Object.assign(download, { [field]: '' });
      else delete download[field];
    } else {
      if (hidden.has(field)) restored.push(field);
      if (value === undefined) delete upload[field];
      else Object.assign(upload, { [field]: value });
    }
  }
  const pack = (value: PersonalInfo) => {
    if (!validProfile(value)) throw Error('云端个人信息无效。');
    return packCloudItem('profile:main', JSON.stringify(value));
  };
  const cloudJSON = JSON.stringify(cloud);
  return {
    upload: JSON.stringify(upload) === cloudJSON ? cloudBlob : pack(upload),
    download: pack(download),
    hasVisibleRemote: hasSavedProfile(download),
    restored,
  };
}

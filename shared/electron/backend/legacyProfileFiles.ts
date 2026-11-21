import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { isCloudProfileOwner, profileDirectoryName } from '../accountProfilePaths';
import { validImageId } from './interview/images';

const shortcutFile = 'shortcut-settings.json';
const updateFile = 'update-settings.json';
const unsafe = () => Error('旧版资料路径无效，原文件已保留。');
const indexBackup = (name: string) =>
  name.startsWith('catalog-backup-') &&
  name.endsWith('.json') &&
  validImageId(name.slice('catalog-backup-'.length, -5));
function missing(error: unknown) {
  return (error as NodeJS.ErrnoException).code === 'ENOENT';
}

// Check every traversed component. Never copy a junction, a symbolic link or a special file.
async function inspect(file: string, directory = false) {
  try {
    const info = await fs.lstat(file);
    if ((await fs.realpath(file)) !== file || (directory ? !info.isDirectory() : !info.isFile()))
      throw unsafe();
    return info;
  } catch (error) {
    if (!missing(error)) throw error;
  }
}

async function ensureDirectory(parent: string, name: string) {
  const directory = path.join(parent, name);
  await fs.mkdir(directory, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'EEXIST') throw error;
  });
  if (!(await inspect(directory, true))) throw unsafe();
  return directory;
}

async function filesIn(root: string, directory: string, accepts: (file: string) => boolean) {
  const parent = path.join(root, directory);
  if (!(await inspect(parent, true))) return [];
  return (await fs.readdir(parent, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && accepts(entry.name))
    .map((entry) => entry.name);
}

async function sources(root: string) {
  const settings: string[] = [];
  for (const name of [shortcutFile, updateFile])
    if (await inspect(path.join(root, name))) settings.push(name);
  const imageFiles = await filesIn(
    root,
    'interview-images-v1',
    (name) =>
      ['.image', '.preview'].includes(path.extname(name)) && validImageId(path.parse(name).name),
  );
  const imageIds = [...new Set(imageFiles.map((name) => path.parse(name).name))];
  const ledgers = await filesIn(root, 'chat-usage', (name) => /^[a-f0-9]{64}\.json$/.test(name));
  const indexRoot = path.join(root, 'knowledge-v1');
  const hasIndex = !!(
    (await inspect(indexRoot, true)) && (await inspect(path.join(indexRoot, 'catalog.json')))
  );
  const auth = path.join(root, 'auth-data');
  const selectionFile = path.join(auth, 'service.json');
  let service: 'chatgpt' | 'copilot' | undefined;
  if (await inspect(auth, true)) {
    const meta = await inspect(selectionFile);
    if (meta && meta.size <= 512) {
      try {
        const raw = JSON.parse(await fs.readFile(selectionFile, 'utf8'));
        const value = typeof raw === 'string' ? raw : raw?.version === 2 ? raw.service : undefined;
        if (value === 'chatgpt' || value === 'copilot') service = value;
      } catch (error) {
        if (!(error instanceof SyntaxError)) throw error;
      }
    }
  }
  return { settings, imageIds, ledgers, hasIndex, service };
}

export async function hasLegacyProfileFiles(userData: string) {
  const found = await sources(await fs.realpath(userData));
  return Boolean(
    found.settings.length ||
    found.imageIds.length ||
    found.ledgers.length ||
    found.hasIndex ||
    found.service,
  );
}

// Publish a complete, private copy without replacing an existing preference, ledger or image.
// Existing records (including a reset usage ledger) always own their current value.
async function publish(
  destination: string,
  signal: AbortSignal,
  write: (temp: string) => Promise<void>,
) {
  signal.throwIfAborted();
  if (await inspect(destination)) return;
  const stage = path.join(path.dirname(destination), '.legacy-' + randomUUID() + '.tmp');
  try {
    await write(stage);
    signal.throwIfAborted();
    try {
      await fs.link(stage, destination);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || !(await inspect(destination)))
        throw error;
    }
  } finally {
    await fs.unlink(stage).catch((error) => {
      if (!missing(error)) throw error;
    });
  }
}

async function copy(source: string, destination: string, signal: AbortSignal) {
  if (!(await inspect(source))) throw unsafe();
  await publish(destination, signal, (stage) =>
    fs.copyFile(source, stage, constants.COPYFILE_EXCL),
  );
}

async function copyImages(root: string, target: string, ids: string[], signal: AbortSignal) {
  if (!ids.length) return;
  const from = path.join(root, 'interview-images-v1');
  const to = await ensureDirectory(target, 'interview-images-v1');
  for (const id of ids) {
    signal.throwIfAborted();
    const original = id + '.image',
      preview = id + '.preview';
    const originalFile = path.join(from, original);
    const sourceInfo = await inspect(originalFile);
    const existing = await inspect(path.join(to, original));
    const oldPreview = await inspect(path.join(from, preview));
    const newPreview = await inspect(path.join(to, preview));
    if (!sourceInfo) {
      if (oldPreview && !existing && !newPreview)
        await copy(path.join(from, preview), path.join(to, preview), signal);
      continue;
    }
    if (existing) {
      // A source preview belongs with the destination only if the original bytes match.
      if (!oldPreview || newPreview) continue;
      if (
        sourceInfo.size !== existing.size ||
        sourceInfo.size > 8 * 1024 ** 2 ||
        !(await fs.readFile(originalFile)).equals(await fs.readFile(path.join(to, original)))
      )
        continue;
    } else {
      if (
        newPreview &&
        (!oldPreview ||
          oldPreview.size !== newPreview.size ||
          oldPreview.size > 128 * 1024 ||
          !(await fs.readFile(path.join(from, preview))).equals(
            await fs.readFile(path.join(to, preview)),
          ))
      )
        continue;
      await copy(originalFile, path.join(to, original), signal);
    }
    if (oldPreview && !newPreview)
      await copy(path.join(from, preview), path.join(to, preview), signal);
  }
}

async function copyIndex(root: string, target: string, signal: AbortSignal) {
  const from = path.join(root, 'knowledge-v1'),
    to = path.join(target, 'knowledge-v1');
  // A published catalog and its LanceDB table versions form one snapshot. Two such snapshots
  // cannot be merged by filename. Existing indexes are reconciled from the merged IndexedDB originals.
  if (await inspect(to, true)) return;
  const stage = await fs.mkdtemp(path.join(target, '.legacy-index-'));
  try {
    const backups = await filesIn(root, 'knowledge-v1', indexBackup);
    for (const name of ['catalog.json', 'revisions', 'lance', ...backups]) {
      signal.throwIfAborted();
      const source = path.join(from, name);
      if (!(await inspect(source, name === 'revisions' || name === 'lance'))) continue;
      await fs.cp(source, path.join(stage, name), {
        recursive: true,
        force: false,
        errorOnExist: true,
        filter: async (file) => {
          signal.throwIfAborted();
          const info = await fs.lstat(file);
          if ((!info.isDirectory() && !info.isFile()) || (await fs.realpath(file)) !== file)
            throw unsafe();
          return true;
        },
      });
    }
    signal.throwIfAborted();
    await fs.rename(stage, to);
  } finally {
    if (path.dirname(stage) !== target || !path.basename(stage).startsWith('.legacy-index-'))
      throw unsafe();
    if (await inspect(stage, true)) await fs.rm(stage, { recursive: true });
  }
}

/** The caller holds the persistent, single-owner upgrade claim and starts profile services only after this returns. */
export async function migrateLegacyProfileFiles(
  userData: string,
  owner: string,
  signal: AbortSignal,
  preserveTargetIndex = false,
) {
  signal.throwIfAborted();
  if (owner !== 'local' && !isCloudProfileOwner(owner)) throw unsafe();
  const root = await fs.realpath(userData);
  const { settings, imageIds, ledgers, hasIndex, service } = await sources(root);
  const profiles = await ensureDirectory(root, 'account-profiles');
  const target = await ensureDirectory(profiles, profileDirectoryName(owner));
  for (const name of settings) await copy(path.join(root, name), path.join(target, name), signal);
  if (service) {
    const auth = await ensureDirectory(target, 'auth-data');
    await publish(path.join(auth, 'service.json'), signal, (stage) =>
      fs.writeFile(stage, JSON.stringify({ version: 2, service, connected: false }), {
        flag: 'wx',
        mode: 0o600,
      }),
    );
  }
  if (ledgers.length) {
    const to = await ensureDirectory(target, 'chat-usage');
    for (const name of ledgers)
      await copy(path.join(root, 'chat-usage', name), path.join(to, name), signal);
  }
  await copyImages(root, target, imageIds, signal);
  if (hasIndex && !preserveTargetIndex) await copyIndex(root, target, signal);
  signal.throwIfAborted();
}

/** Called only for an explicitly erased, verified upgrade claimant while both profiles are closed. */
export async function eraseLegacyProfileFiles(userData: string) {
  const root = await fs.realpath(userData);
  const { settings, imageIds, ledgers, service } = await sources(root);
  const images = path.join(root, 'interview-images-v1');
  const usage = path.join(root, 'chat-usage');
  const knowledge = path.join(root, 'knowledge-v1');
  const files = [
    ...settings.map((name) => path.join(root, name)),
    ...imageIds.flatMap((id) => ['.image', '.preview'].map((ext) => path.join(images, id + ext))),
    ...ledgers.map((name) => path.join(usage, name)),
    ...(service ? [path.join(root, 'auth-data', 'service.json')] : []),
  ];
  const indexTrees: string[] = [];
  if (await inspect(knowledge, true)) {
    files.push(path.join(knowledge, 'catalog.json'));
    for (const name of await filesIn(root, 'knowledge-v1', indexBackup))
      files.push(path.join(knowledge, name));
    for (const name of ['revisions', 'lance']) {
      const directory = path.join(knowledge, name);
      if (await inspect(directory, true)) indexTrees.push(directory);
    }
  }
  // Validate all destinations before unlinking. The old OS vaults, device identity, cached models
  // and every owner-specific recording directory remain outside this list.
  const existing: string[] = [];
  for (const file of files) if (await inspect(file)) existing.push(file);
  for (const file of existing) await fs.unlink(file);
  for (const directory of indexTrees) {
    if (path.dirname(directory) !== knowledge || !(await inspect(directory, true))) throw unsafe();
    await fs.rm(directory, { recursive: true });
  }
  for (const directory of [images, usage, knowledge]) {
    if (!(await inspect(directory, true))) continue;
    await fs.rmdir(directory).catch((error: NodeJS.ErrnoException) => {
      if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error.code ?? '')) throw error;
    });
  }
}

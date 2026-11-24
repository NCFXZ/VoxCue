import { readdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { atomicFile, syncDirectory } from '../atomicFile';
import {
  checkedDirectory, checkedFile, ensureDirectory, invalidLayout, layoutFile, legacyIndexFile,
  libraryDirectory, ownedTable, readJson, readLayout, revisionFile, type LegacyIndexFiles,
} from './libraryLayout';

const stagingName = '.library-split';
const migrationFile = '.library-split.json';

async function legacyFiles(root: string): Promise<LegacyIndexFiles> {
  const lancedir = path.join(root, 'lance');
  const revisions = path.join(root, 'revisions');
  return {
    catalogs: (await readdir(root)).filter(name => legacyIndexFile(name)),
    tables: (await checkedDirectory(lancedir) ? await readdir(lancedir) : [])
      .filter(name => name.endsWith('.lance') && ownedTable.test(name.slice(0, -6)))
      .map(name => name.slice(0, -6)),
    revisions: (await checkedDirectory(revisions) ? await readdir(revisions) : [])
      .filter(name => revisionFile.test(name)),
  };
}

async function retireLegacy(root: string, files: LegacyIndexFiles, progressed?: () => void) {
  const lancedir = path.join(root, 'lance'), revisions = path.join(root, 'revisions');
  if (await checkedDirectory(lancedir)) {
    for (const name of files.tables) {
      const table = path.join(lancedir, name + '.lance');
      progressed?.();
      if (await checkedDirectory(table)) await rm(table, { recursive: true });
    }
    await syncDirectory(lancedir);
  }
  if (await checkedDirectory(revisions)) {
    for (const name of files.revisions) {
      const file = path.join(revisions, name);
      if (await checkedFile(file)) await rm(file);
      progressed?.();
    }
    await syncDirectory(revisions);
  }
  for (const name of files.catalogs) {
    const file = path.join(root, name);
    if (await checkedFile(file)) await rm(file);
    progressed?.();
  }
  await syncDirectory(root);
}

/** Retire the old shared index once. Renderer reconciliation indexes the original files. */
export async function migrateLibraryLayout(root: string, progressed?: () => void) {
  await ensureDirectory(root);
  const published = path.join(root, libraryDirectory), manifest = path.join(published, layoutFile);
  const pending = path.join(root, migrationFile), stage = path.join(root, stagingName);
  let layout = await readLayout(root);
  if (!layout) {
    const receipt = await readJson(pending, 128) as { version?: unknown } | undefined;
    if (receipt !== undefined && receipt?.version !== 1) throw invalidLayout();
    if (await checkedDirectory(stage)) {
      if (!receipt) throw invalidLayout();
      // Older builds could leave a partially copied index here. Until the layout
      // is published, all of that output is temporary.
      progressed?.();
      await rm(stage, { recursive: true });
    }
    if (!receipt) await atomicFile(pending, JSON.stringify({ version: 1 }));
    const legacy = await legacyFiles(root);
    await ensureDirectory(stage);
    await atomicFile(path.join(stage, layoutFile), JSON.stringify({ version: 1, legacy }));
    await rename(stage, published);
    await syncDirectory(root);
    layout = { legacy };
  }
  if (layout.legacy) {
    // A complete layout from an earlier build can also have a cleanup receipt.
    // Its published per-library tables are outside every retirement path.
    await retireLegacy(root, layout.legacy, progressed);
    if (await checkedFile(pending)) await rm(pending);
    await syncDirectory(root);
    await atomicFile(manifest, JSON.stringify({ version: 1 }));
  }
}

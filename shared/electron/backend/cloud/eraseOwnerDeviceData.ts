import { lstat, readFile, readdir, realpath, rmdir } from 'node:fs/promises';
import path from 'node:path';
import type { CredentialEncryption } from '../auth/storage';
import { atomicFile } from '../atomicFile';
import { storedTelemetryProofs, type TelemetryProofState } from '../telemetry/identity';
import { telemetryQueueFile } from '../telemetry/queue';
import { storedCloudCredentials } from './client';
import { createCredentialVault } from './vault';

async function inspect(file: string, directory = false) {
  const stat = await lstat(file).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error;
  });
  if (stat && ((directory ? !stat.isDirectory() : !stat.isFile()) || await realpath(file) !== file))
    throw Error('账号资料路径已重定向，清理已停止。');
  return stat;
}

/** Runs after writers stop, including before telemetry starts on crash recovery. */
export async function eraseOwnerDeviceData(userData: string, origin: string, userId: string, crypto?: CredentialEncryption) {
  const root = await realpath(userData);
  const dir = path.join(root, 'cloud-account');
  const exists = await inspect(dir, true);
  const proofsFile = path.join(dir, 'telemetry.bin');
  const vault = createCredentialVault<TelemetryProofState>(proofsFile, crypto, 262144);
  const saved = exists && await inspect(proofsFile) ? await vault.read() : null;
  const proofs = saved === null ? undefined : storedTelemetryProofs(saved, origin);
  const owned = new Set(proofs?.tickets.filter(ticket => ticket.userId === userId).map(ticket => ticket.id));
  const queue = path.join(root, telemetryQueueFile);
  const stat = await inspect(queue);
  if (stat) {
    if (stat.size > 4 * 1024 * 1024) throw Error('本机统计队列无效。');
    const state = JSON.parse(await readFile(queue, 'utf8'));
    if (![1, 2].includes(state?.schemaVersion) || !Array.isArray(state.events)) throw Error('本机统计队列无效。');
    const belongs = (event: { userId?: string; identityRef?: string } | undefined) =>
      event?.userId === userId || (typeof event?.identityRef === 'string' && owned.has(event.identityRef));
    const events = state.events.filter((event: Parameters<typeof belongs>[0]) => !belongs(event));
    if (events.length !== state.events.length || belongs(state.active)) {
      if (belongs(state.active)) delete state.active;
      await atomicFile(queue, JSON.stringify({ ...state, events }));
    }
  }
  // Keep proof IDs available until the queue no longer references them, including on retry.
  if (proofs && owned.size) {
    const tickets = proofs.tickets.filter(ticket => ticket.userId !== userId);
    if (tickets.length) await vault.write({ ...proofs, tickets });
    else await vault.clear();
  }
  if (!exists) return;
  for (const name of await readdir(dir)) {
    const recovery = /^session\.bin\.[\da-f-]{36}\.recovery$/i.test(name);
    if (!recovery && name !== 'session.bin') continue;
    const file = path.join(dir, name);
    if (!await inspect(file)) continue;
    const session = createCredentialVault(file, crypto);
    let id: string | undefined;
    try { id = storedCloudCredentials(await session.read(), origin).user.id; }
    catch (error) {
      // A historical recovery copy may need its original key; ownership is then unknown.
      if (!recovery) throw error;
    }
    if (id === userId) await session.clear();
  }
  await rmdir(dir).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT' && error.code !== 'ENOTEMPTY' && error.code !== 'EEXIST') throw error;
  });
}

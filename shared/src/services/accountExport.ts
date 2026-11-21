import { t, uiLocale } from '../i18n';
import { historyRepository, type InterviewRecord } from './history';
import { localKnowledge } from './knowledge';
import { usePreparation } from '../stores/preparation';
import type { AccountDataCall } from '../../electron/contracts/accountData';
import { profileLabels } from '../../electron/contracts/profile';
import { useCloudAccount } from '../stores/cloudAccount';
import { readAccountSyncSaved } from '../stores/cloudSync';
import { stopCloudWork } from './cloudLifecycle';
import { decodeCloudItem, localCloudItems, packCloudItem } from './cloudData';
import { downloadCloudBlob } from './cloudDownload';
import { movedCloudItems, projectMovedProfile } from './migrationSyncProtection';
import type { CloudResource, CloudResourceList } from '../../electron/contracts/cloudSync';
import { recordFeature } from './telemetry';

export async function exportAccountData(): Promise<boolean> {
  await stopCloudWork();
  try {
    return await exportSavedData();
  } finally {
    useCloudAccount.setState((s) => ({ revision: s.revision + 1 }));
  }
}
async function exportSavedData(): Promise<boolean> {
  const api = window.desktop?.accountData;
  if (!api) throw Error('请在桌面应用中导出资料。');
  const { user, localMode } = useCloudAccount.getState().state;
  const userId = user?.id;
  const owner = localStorage.getItem('voxcue-sync-owner');
  if (!userId && !localMode) throw Error('请登录 VoxCue 或选择本地账户后导出。');
  if (userId && owner && owner !== userId)
    throw Error('本机资料与当前账号不符，请切回原账号后导出。');
  const saved = userId || owner ? await readAccountSyncSaved((userId || owner)!) : undefined;
  const moved = userId ? movedCloudItems(userId) : undefined;
  const remoteOnly = new Map<string, CloudResource>();
  const guardOwner = () => {
    const current = useCloudAccount.getState().state;
    if (current.user?.id !== userId || current.localMode !== localMode) throw Error('账号已变化，请重新导出资料。');
  };
  const readRemote = (resource: CloudResource) => downloadCloudBlob(resource, async call => {
    guardOwner();
    const response = await window.desktop!.cloudSync({ ...call, userId: userId! });
    guardOwner();
    if (!response.ok) throw Error(response.error);
    return response.value;
  });
  const keys = new Set<string>();
  for (const kind of ['profile', 'history', 'knowledgebase'] as const)
    for (const item of await localCloudItems(kind)) keys.add(item.key);
  if (localMode && !userId) {
    if (Object.values(saved?.baselines ?? {}).some((baseline) => baseline.unrestored))
      throw Error('有尚未恢复到本机的云端资料，请登录原账号并完成下载后再导出。');
  } else {
    let cursor: string | undefined;
    const cursors = new Set<string>();
    do {
      const result = await window.desktop!.cloudSync({ action: 'list', userId: userId!, cursor });
      if (!result.ok) throw Error('无法核对云端资料，请恢复网络后导出。');
      const page = result.value as CloudResourceList;
      if (!Array.isArray(page.items) || page.items.length > 50) throw Error('云端资料列表无效。');
      for (const item of page.items) {
        const baseline = saved!.baselines[item.name];
        if (item.headVersion && moved && (
          (!keys.has(item.name) && (moved.keys.has(item.name) || (baseline?.parent && moved.keys.has(baseline.parent)))) ||
          (item.name === 'profile:main' && moved.fields.size && (!keys.has(item.name) || baseline?.hash === item.sha256))
        )) {
          remoteOnly.set(item.name, item);
          continue;
        }
        if (
          item.headVersion &&
          (!keys.has(item.name) ||
            !baseline ||
            baseline.unrestored ||
            baseline.hash !== item.sha256)
        )
          throw Error('云端有尚未恢复的资料，请先启用三项同步、完成下载并处理冲突，再导出资料。');
      }
      cursor = page.nextCursor ?? undefined;
      if (cursor && (cursors.has(cursor) || cursors.size > 82)) throw Error('云端分页无效。');
      if (cursor) cursors.add(cursor);
    } while (cursor);
  }
  const histories = await historyRepository.list();
  const bases = await localKnowledge.listBases();
  const movedRecords: CloudResource[] = [], movedDocuments: CloudResource[] = [];
  for (const resource of remoteOnly.values()) {
    if (resource.name.startsWith('record:')) movedRecords.push(resource);
    else if (/^(file|resume):/.test(resource.name)) movedDocuments.push(resource);
    else if (resource.name.startsWith('base:')) {
      const item = await decodeCloudItem(resource.name, await readRemote(resource));
      if (item.type !== 'base') throw Error('云端知识库无效。');
      bases.push(item.base);
    }
  }
  // A resume can exist without a visible knowledge library.
  if (!bases.some((b) => b.id === 'personal-resume'))
    bases.push({ id: 'personal-resume', name: t('个人简历'), createdAt: 0 });
  const libraries = [];
  for (const base of bases)
    libraries.push({ base, documents: await localKnowledge.listDocuments(base.id) });
  let info = usePreparation.getState().info;
  const cloudProfile = remoteOnly.get('profile:main');
  if (cloudProfile && moved) {
    const projected = await projectMovedProfile(packCloudItem('profile:main', JSON.stringify(info)), await readRemote(cloudProfile), moved.fields);
    const item = await decodeCloudItem('profile:main', projected.upload);
    if (item.type !== 'profile') throw Error('云端个人信息无效。');
    info = item.profile;
  }
  const personal = Object.entries(info)
    .map(([key, value]) => {
      const label = profileLabels[key as keyof typeof profileLabels] ?? key;
      const text = Array.isArray(value)
        ? value
            .map(
              (skill) =>
                `${skill.title}\n${skill.content}\n${skill.sources?.map((s: { title: string; url: string }) => `${s.title}: ${s.url}`).join('\n') ?? ''}`,
            )
            .join('\n\n')
        : (value ?? '');
      return `${t(label)}\n${text}`;
    })
    .join('\n\n');
  guardOwner();
  const start = await api({
    action: 'begin',
    files: 1 + histories.length + movedRecords.length + movedDocuments.length + libraries.reduce((n, b) => n + b.documents.length, 0),
  });
  if (!start.ok) throw Error(start.error);
  if (start.canceled) return false;
  const token = start.token!;
  const send = async (call: AccountDataCall) => {
    guardOwner();
    const result = await api(call);
    if (!result.ok) throw Error(result.error);
    return result;
  };
  const file = async (call: Extract<AccountDataCall, { action: 'file' }>, blob: Blob) => {
    await send(call);
    for (let offset = 0; offset < blob.size; offset += 1048576)
      await send({
        action: 'chunk',
        token,
        bytes: new Uint8Array(await blob.slice(offset, offset + 1048576).arrayBuffer()),
      });
    await send({ action: 'end', token });
  };
  try {
    const text = new Blob([personal], { type: 'text/plain;charset=utf-8' });
    await file(
      { action: 'file', token, kind: 'personal', name: t('个人信息.txt'), size: text.size },
      text,
    );
    const staged = new Set<string>();
    const writeRecord = async (record: InterviewRecord, index: number) => {
      const images = [...new Set(record.answers.flatMap((a) => a.images?.map((image) => image.id) ?? []))];
      for (const id of images) {
        const resource = remoteOnly.get('image:' + id);
        if (!resource || staged.has(id)) continue;
        const image = await decodeCloudItem(resource.name, await readRemote(resource));
        if (image.type !== 'image') throw Error('云端截图数据无效。');
        await send({ action: 'stageImage', token, id, bytes: new Uint8Array(await image.payload.arrayBuffer()) });
        staged.add(id);
      }
      const transcript = [
        record.title,
        t('开始：{0}', [new Date(record.startedAt).toLocaleString(uiLocale())]),
        t('结束：{0}', [new Date(record.endedAt).toLocaleString(uiLocale())]),
        '\n' + t('转录'),
        ...record.transcripts.map(
          (row) =>
            `${row.time} ${t('{0}：{1}', [t(row.source === 'microphone' ? '面试者' : '面试官'), row.text])}`,
        ),
        '\n' + t('问答'),
        ...record.answers.map((a) => `${a.question}\n${a.content}`),
      ].join('\n');
      const data = new Blob([transcript], { type: 'text/plain;charset=utf-8' });
      await file(
        {
          action: 'file',
          token,
          kind: 'record',
          name: `${index + 1}-${record.title}.txt`,
          size: data.size,
          images,
        },
        data,
      );
    };
    let recordNumber = 0;
    for (const record of histories) await writeRecord(record, recordNumber++);
    for (const resource of movedRecords) {
      const item = await decodeCloudItem(resource.name, await readRemote(resource));
      if (item.type !== 'record') throw Error('云端面试记录无效。');
      await writeRecord(item.record, recordNumber++);
    }
    for (const { base, documents } of libraries) {
      if (base.id === 'personal-resume' && !documents.length) continue;
      await send({ action: 'base', token, baseId: base.id, baseName: base.name });
      for (const doc of documents)
        await file(
          {
            action: 'file',
            token,
            kind: 'document',
            name: doc.name,
            baseId: base.id,
            baseName: base.name,
            size: doc.blob.size,
          },
          doc.blob,
        );
    }
    for (const resource of movedDocuments) {
      const item = await decodeCloudItem(resource.name, await readRemote(resource));
      if (item.type !== 'file' && item.type !== 'resume') throw Error('云端文件元数据无效。');
      const doc = item.document, base = bases.find(base => base.id === doc.baseId);
      if (!base) throw Error('云端文件所属知识库无效。');
      await file({ action: 'file', token, kind: 'document', name: doc.name, size: doc.size,
        baseId: base.id, baseName: base.name }, doc.blob);
    }
    const result = await send({ action: 'finish', token });
    if (result.saved) recordFeature('data_export');
    return result.saved === true;
  } catch (error) {
    await api({ action: 'cancel', token }).catch(() => {});
    throw error;
  }
}

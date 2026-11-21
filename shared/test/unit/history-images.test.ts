import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useHistory } from '../../src/stores/history';
import { createHistoryService, historyRepository, historyStorageKey, recoverLocalHistoryImages, type InterviewRecord } from '../../src/services/history';
import { readHistoryRecordings } from '../../src/services/historyRecordingRemoval';
import { deferHistoryImageCleanup, stageHistoryImages } from '../../src/services/historyImageRemoval';
import { applyCloudItem, digestCloudBlob, localCloudItem, packCloudItem } from '../../src/services/cloudData';

const first = '11111111-1111-4111-8111-111111111111';
const second = '22222222-2222-4222-8222-222222222222';
let values: Map<string, string>;
const cleanup = vi.fn();
const record = (id: string, image: string): InterviewRecord => ({
  id,
  title: '合成面试',
  startedAt: 1,
  endedAt: 2,
  status: 'ended',
  mock: false,
  transcripts: [],
  answers: [
    { id: 'a', question: '题目', content: '回答', provider: 'chatgpt', images: [{ id: image }] },
  ],
});
beforeEach(() => {
  values = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
  cleanup.mockReset().mockResolvedValue({ ok: true });
  vi.stubGlobal('window', { desktop: { interviewImage: cleanup } });
  useHistory.setState({ records: [], error: null });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('归档只保留图片引用，跨实例加载及重命名保留引用和旧记录', () => {
  const history = createHistoryService(localStorage);
  history.save(record('one', first));
  history.save({
    ...record('old', second),
    answers: [{ id: 'old-a', question: '旧题', content: '旧回答' }],
  });
  history.rename('one', '新标题');
  const restored = createHistoryService(localStorage).list();
  expect(restored.find((r) => r.id === 'one')?.answers[0].images).toEqual([{ id: first }]);
  expect(restored.find((r) => r.id === 'old')?.answers[0].images).toBeUndefined();
});

it('删除成功后清理独占图片，仍被其他记录引用的图片保留', async () => {
  await useHistory.getState().save(record('one', first));
  await useHistory.getState().save(record('two', first));
  expect(await useHistory.getState().remove('one')).toBe(true);
  expect(cleanup).not.toHaveBeenCalled();
  expect(await useHistory.getState().remove('two')).toBe(true);
  expect(cleanup).toHaveBeenCalledWith({ op: 'remove', ids: [first] });
});

it.each(['success', 'history-full', 'image-busy'] as const)('云覆盖减少截图后按已提交的完整历史清理：%s', async (outcome) => {
  const history = createHistoryService(localStorage);
  const old = record('one', first);
  old.answers[0].images!.push({ id: second });
  history.save(old);
  history.save(record('shared', second));
  Object.assign(window, { dispatchEvent: vi.fn() });
  const key = 'record:one';
  const expected = await digestCloudBlob(await (await localCloudItem('history', key))!.blob());
  const blob = packCloudItem(key, JSON.stringify({ ...old, answers: [] }));
  if (outcome === 'history-full') {
    vi.spyOn(localStorage, 'setItem').mockImplementation((key, value) => {
      if (key === historyStorageKey) throw Error('quota');
      values.set(key, value);
    });
    await expect(applyCloudItem(key, blob, expected)).rejects.toThrow('quota');
    await useHistory.getState().recoverRecordings();
    expect(history.list().find(r => r.id === old.id)).toEqual(old);
    expect(cleanup).not.toHaveBeenCalled();
    return;
  }
  await applyCloudItem(key, blob, expected);
  if (outcome === 'image-busy') cleanup.mockRejectedValueOnce(Error('busy'));
  await useHistory.getState().recoverRecordings();
  if (outcome === 'image-busy') {
    expect(useHistory.getState().error).toContain('截图清理失败');
    await useHistory.getState().recoverRecordings();
  }
  await useHistory.getState().remove(old.id);
  const calls = cleanup.mock.calls.map(([call]) => call);
  expect(calls).toEqual(Array(outcome === 'image-busy' ? 2 : 1).fill({ op: 'remove', ids: [first] }));
  expect(history.list()[0].answers[0].images).toEqual([{ id: second }]);
});

it('同批后一个云记录接管图片时，在途打开历史页也保留原件', async () => {
  const history = createHistoryService(localStorage);
  history.save(record('from', first));
  Object.assign(window, { dispatchEvent: vi.fn() });
  const key = 'record:from';
  const old = await digestCloudBlob(await (await localCloudItem('history', key))!.blob());
  const release = deferHistoryImageCleanup();
  try {
    await applyCloudItem(key, packCloudItem(key, JSON.stringify({ ...record('from', first), answers: [] })), old);
    await useHistory.getState().recoverRecordings();
    expect(cleanup).not.toHaveBeenCalled();
    await applyCloudItem('record:to', packCloudItem('record:to', JSON.stringify(record('to', first))));
  } finally {
    release();
  }
  await useHistory.getState().recoverRecordings();
  expect(cleanup.mock.calls).toEqual([[{ op: 'syncDigest', id: first }]]);
  await useHistory.getState().remove('to');
  expect(cleanup).toHaveBeenLastCalledWith({ op: 'remove', ids: [first] });
});

it('重启清理了旧图后，恢复另一条引用同图的云记录会先取回受控原件', async () => {
  const history = createHistoryService(localStorage);
  history.save(record('from', first));
  let present = true;
  cleanup.mockImplementation(async ({ op }: { op: string }) => {
    if (op === 'remove') present = false;
    return { ok: op === 'remove' || present };
  });
  const cloudSync = vi.fn(async () => { present = true; return { ok: true }; });
  Object.assign(window, { dispatchEvent: vi.fn(), desktop: { interviewImage: cleanup, cloudSync } });
  const key = 'record:from';
  const old = await digestCloudBlob(await (await localCloudItem('history', key))!.blob());
  await applyCloudItem(key, packCloudItem(key, JSON.stringify({ ...record('from', first), answers: [] })), old);
  await useHistory.getState().recoverRecordings();
  expect(present).toBe(false);
  const download = vi.fn(async () => packCloudItem('image:' + first, new Uint8Array([123]), {
    id: first, preview: 'data:image/png;base64,QQ==',
  }));
  await applyCloudItem('record:to', packCloudItem('record:to', JSON.stringify(record('to', first))),
    undefined, 'synthetic-user', () => {}, download);
  expect(download).toHaveBeenCalledExactlyOnceWith(first);
  expect(cloudSync).toHaveBeenCalledExactlyOnceWith({ action: 'restoreImage', userId: 'synthetic-user',
    id: first, bytes: new Uint8Array([123]), preview: 'data:image/png;base64,QQ==' });
  expect(history.list().find(row => row.id === 'to')?.answers[0].images).toEqual([{ id: first }]);
});

it('保存后只刷新一次轻量目录，保留手动标题、排序及可按需读取的完整详情', async () => {
  const history = createHistoryService(localStorage);
  history.save({ ...record('older', first), startedAt: 10 });
  history.save({ ...record('newer', second), startedAt: 20 });
  history.rename('older', '自定义标题');
  const read = vi.spyOn(historyRepository, 'summaries');
  const write = vi.spyOn(localStorage, 'setItem');
  await useHistory.getState().save({ ...record('older', first), startedAt: 10, endedAt: 12, title: '迟到的标题' });
  expect(read).toHaveBeenCalledTimes(1);
  expect(write).toHaveBeenCalledTimes(1);
  expect(useHistory.getState().records.map(r => r.id)).toEqual(['newer', 'older']);
  expect(useHistory.getState().records[1].title).toBe('自定义标题');
  expect(useHistory.getState().records[1]).not.toHaveProperty('answers');
  expect(await useHistory.getState().getRecord('older')).toEqual(history.list()[1]);
});

it('记录写入失败不删除原图；原图清理失败有明确提示', async () => {
  await useHistory.getState().save(record('one', first));
  vi.spyOn(localStorage, 'setItem').mockImplementationOnce(() => {
    throw Error('full');
  });
  expect(await useHistory.getState().remove('one')).toBe(false);
  expect(cleanup).not.toHaveBeenCalled();
  cleanup.mockResolvedValue({ ok: false, error: { message: 'disk failed' } });
  expect(await useHistory.getState().remove('one')).toBe(true);
  expect(useHistory.getState().error).toContain('截图清理失败');
  cleanup.mockResolvedValue({ ok: true });
  expect(await useHistory.getState().remove('one')).toBe(true);
  expect(cleanup).toHaveBeenCalledTimes(2);
  expect(useHistory.getState().error).toBeNull();
});

it('截图已登记但历史未提交时，恢复保留原图；提交后崩溃则下次继续清理', async () => {
  const history = createHistoryService(localStorage);
  history.save(record('one', first));
  const write = vi.spyOn(localStorage, 'setItem').mockImplementation((key, value) => {
    if (key === historyStorageKey) throw Error('quota');
    values.set(key, value);
  });
  expect(await useHistory.getState().remove('one')).toBe(false);
  write.mockRestore();
  await useHistory.getState().recoverRecordings();
  expect(cleanup).not.toHaveBeenCalled();
  expect(history.list()).toHaveLength(1);
  history.remove('one');
  const previousAccount = values;
  values = new Map();
  await useHistory.getState().recoverRecordings();
  expect(cleanup).not.toHaveBeenCalled();
  values = previousAccount;
  await useHistory.getState().recoverRecordings();
  await useHistory.getState().recoverRecordings();
  expect(cleanup.mock.calls).toEqual([[{ op: 'remove', ids: [first] }]]);
});

it('保留新恢复的共享引用，忽略仅供旧版显示的引用，重试只处理未确认批次', async () => {
  const ids = Array.from({ length: 103 }, (_, i) => '00000000-0000-4000-8000-' + String(i).padStart(12, '0'));
  const history = createHistoryService(localStorage);
  history.save({ ...record('large', first), answers: [...ids, 'legacy-preview'].map((id, index) =>
    ({ id: String(index), question: '', content: '', images: [{ id }] })) });
  cleanup.mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({ ok: false });
  expect(await useHistory.getState().remove('large')).toBe(true);
  expect(cleanup.mock.calls.map(([call]) => call.ids)).toEqual([ids.slice(0, 100), ids.slice(100)]);
  history.save(record('shared', ids[101]));
  cleanup.mockClear();
  await useHistory.getState().recoverRecordings();
  await useHistory.getState().recoverRecordings();
  expect(cleanup.mock.calls).toEqual([[{ op: 'remove', ids: [ids[100], ids[102]] }]]);
});

it('旧截图一直被占用时仍能清理后来删除的截图，每轮仅尝试每批一次', async () => {
  await useHistory.getState().save(record('old', first));
  await useHistory.getState().save(record('new', second));
  cleanup.mockImplementation(async ({ ids }) => {
    if (ids.includes(first)) throw Error('busy');
    return { ok: true };
  });
  expect(await useHistory.getState().remove('old')).toBe(true);
  cleanup.mockClear();
  expect(await useHistory.getState().remove('new')).toBe(true);
  expect(cleanup.mock.calls.map(([call]) => call.ids)).toEqual([[first], [second]]);
  cleanup.mockReset().mockResolvedValue({ ok: true });
  await useHistory.getState().recoverRecordings();
  await useHistory.getState().recoverRecordings();
  expect(cleanup.mock.calls.map(([call]) => call.ids)).toEqual([[first]]);
});
it('按百张合并，同轮重新检查历史和账号，保留后来接管的原图', async () => {
  const ids = Array.from({ length: 205 }, (_, i) => '00000000-0000-4000-8000-' + String(i).padStart(12, '0'));
  for (const id of ids) stageHistoryImages(localStorage, record(id, id));
  const history = createHistoryService(localStorage);
  cleanup.mockImplementationOnce(async () => {
    history.save(record('restored', ids[110]));
    return { ok: true };
  });
  const owner = vi.fn().mockImplementationOnce(() => {}).mockImplementationOnce(() => {})
    .mockImplementationOnce(() => { throw Error('account changed'); });
  await expect(recoverLocalHistoryImages(owner)).rejects.toThrow('account changed');
  expect(cleanup.mock.calls.map(([call]) => call.ids)).toEqual([
    ids.slice(0, 100), ids.slice(100, 200).filter(id => id !== ids[110]),
  ]);
  cleanup.mockClear();
  await recoverLocalHistoryImages();
  expect(cleanup.mock.calls.map(([call]) => call.ids)).toEqual([ids.slice(200)]);
});

it.each([true, false])('恢复图片期间的清理等待恢复结果；恢复成功=%s', async (success) => {
  const history = createHistoryService(localStorage);
  history.save(record('old', first));
  history.remove('old');
  let resolveRestore!: (value: { ok: boolean; error?: string }) => void;
  const cloudSync = vi.fn(() => new Promise(resolve => { resolveRestore = resolve; }));
  vi.stubGlobal('window', { desktop: { cloudSync, interviewImage: cleanup }, dispatchEvent: vi.fn() });
  const key = 'image:' + first;
  const blob = packCloudItem(key, new Uint8Array([1]), { id: first, preview: 'data:image/png;base64,QQ==' });
  const restore = applyCloudItem(key, blob, undefined, 'synthetic-user');
  await vi.waitFor(() => expect(cloudSync).toHaveBeenCalledOnce());
  const pending = useHistory.getState().recoverRecordings();
  await Promise.resolve();
  expect(cleanup).not.toHaveBeenCalled();
  resolveRestore({ ok: success, error: 'synthetic failure' });
  if (success) await restore;
  else await expect(restore).rejects.toThrow('synthetic failure');
  await pending;
  if (success) {
    expect(history.list()).toHaveLength(0);
    expect(cleanup).not.toHaveBeenCalled();
  } else expect(cleanup.mock.calls).toEqual([[{ op: 'remove', ids: [first] }]]);
});

it('损坏图片引用或外部缩略图不会被静默读取/覆盖', () => {
  for (const images of [
    [{ id: '../file' }],
    [{ id: first, preview: 'https://example.test/image' }],
    Array.from({ length: 6 }, () => ({ id: first })),
  ]) {
    const raw = JSON.stringify([
      { ...record('bad', first), answers: [{ ...record('bad', first).answers[0], images }] },
    ]);
    const write = vi.fn();
    const history = createHistoryService({ getItem: () => raw, setItem: write });
    expect(() => history.list()).toThrow();
    expect(write).not.toHaveBeenCalled();
  }
});

it('删除文字失败时还原暂存录音；重启按已持久化的文字记录恢复或清理', async () => {
  const recordings = vi.fn().mockResolvedValue([]);
  vi.stubGlobal('window', { desktop: { recordings, pendingRecordingRemovals: async () => [first, second] } });
  createHistoryService(localStorage).save(record(first, second));
  vi.spyOn(localStorage, 'setItem').mockImplementationOnce(() => { throw Error('full'); });
  expect(await useHistory.getState().remove(first)).toBe(false);
  expect(recordings.mock.calls.map(([call]) => call.op)).toEqual(['stage-remove', 'restore-remove']);
  expect(createHistoryService(localStorage).list().map(r => r.id)).toEqual([first]);
  expect(useHistory.getState().error).toContain('均已保留');
  recordings.mockClear();
  await useHistory.getState().recoverRecordings();
  expect(recordings.mock.calls.map(([call]) => call)).toEqual([
    { op: 'restore-remove', recordId: first }, { op: 'finish-remove', recordId: second },
  ]);
});

it('删除正在暂存时打开历史页面，恢复不会还原在途目录或导致二次删除', async () => {
  let finishStage!: () => void;
  const staged = new Promise<void>(resolve => { finishStage = resolve; });
  const recordings = vi.fn(async (call: { op: string }) => {
    if (call.op === 'stage-remove') await staged;
    return [];
  });
  vi.stubGlobal('window', { desktop: { recordings, pendingRecordingRemovals: async () => [first] } });
  createHistoryService(localStorage).save(record(first, second));
  const deleting = useHistory.getState().remove(first);
  await useHistory.getState().recoverRecordings();
  expect(await useHistory.getState().remove(first)).toBe(false);
  expect(recordings.mock.calls.map(([call]) => call.op)).toEqual(['stage-remove']);
  finishStage();
  expect(await deleting).toBe(true);
  expect(recordings.mock.calls.map(([call]) => call.op)).toEqual(['stage-remove', 'finish-remove']);
});

it('一个暂存目录无法恢复时仍处理其他已提交的录音清理', async () => {
  const recordings = vi.fn().mockRejectedValueOnce(Error('busy')).mockResolvedValue([]);
  vi.stubGlobal('window', { desktop: { recordings, pendingRecordingRemovals: async () => [first, second] } });
  createHistoryService(localStorage).save(record(first, second));
  await useHistory.getState().recoverRecordings();
  expect(recordings.mock.calls.map(([call]) => call.op)).toEqual(['restore-remove', 'finish-remove']);
  expect(useHistory.getState().error).toContain('录音恢复尚未完成');
});

it('崩溃后立即打开详情会等待目录恢复，重复打开页面共享同一次恢复', async () => {
  let finishRestore!: () => void;
  const restoring = new Promise<void>(resolve => { finishRestore = resolve; });
  const recordings = vi.fn(async (call: { op: string }) => {
    if (call.op === 'restore-remove') await restoring;
    return [];
  });
  const pendingRecordingRemovals = vi.fn(async () => [first]);
  vi.stubGlobal('window', { desktop: { recordings, pendingRecordingRemovals } });
  createHistoryService(localStorage).save(record(first, second));
  const startup = useHistory.getState().recoverRecordings();
  const page = useHistory.getState().recoverRecordings();
  const detail = readHistoryRecordings(first);
  await vi.waitFor(() => expect(recordings).toHaveBeenCalledTimes(1));
  expect(pendingRecordingRemovals).toHaveBeenCalledTimes(1);
  expect(recordings.mock.calls.map(([call]) => call.op)).toEqual(['restore-remove']);
  finishRestore();
  await Promise.all([startup, page, detail]);
  expect(recordings.mock.calls.map(([call]) => call.op)).toEqual(['restore-remove', 'list']);
});

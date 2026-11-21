import { afterEach, expect, it, vi } from 'vitest';
import { useInterview } from '../../src/stores/interview';
import { useHistory } from '../../src/stores/history';
import { historyRepository } from '../../src/services/history';
import type { SpeechEvent } from '../../electron/contracts/speech';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { recoverInterviewDrafts, startInterviewDraft } from '../../src/services/interviewDraft';
import { mockAI } from '../../src/services/mock';

afterEach(() => {
  useInterview.getState().reset();
  useInterview.setState({ configurationLocked: false });
  vi.unstubAllGlobals();
});
async function fixture() {
  const values = new Map<string, string>();
  let fail = false,
    receive: (event: SpeechEvent) => void = () => {};
  const speech = vi.fn(async () => ({ state: 'running', model: 'synthetic' }));
  const title = vi.fn(async () => {});
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    removeItem: (key: string) => values.delete(key),
    setItem: (key: string, value: string) => {
      if (fail) throw Error('storage full');
      values.set(key, value);
    },
  });
  vi.stubGlobal('window', {
    desktop: {
      speech,
      generateInterviewTitle: title,
      onSpeechEvent: (callback: typeof receive) => {
        receive = callback;
        return () => {
          receive = () => {};
        };
      },
    },
  });
  useInterview.getState().reset();
  useInterview.setState({ configurationLocked: false });
  useInterview.getState().configure({ mode: 'local', aiEnabled: false, modelId: '' });
  useInterview.getState().setAutoAnswer(false);
  useInterview.getState().start();
  await Promise.resolve();
  await Promise.resolve();
  speech.mockClear();
  return {
    speech,
    title,
    emit: (event: SpeechEvent) => receive(event),
    fail: (value: boolean) => {
      fail = value;
    },
  };
}
it('recovers final speech, completed answers and recording-only interviews after their writer disappears', async () => {
  const ownerDatabase = new IDBFactory();
  vi.stubGlobal('indexedDB', ownerDatabase);
  vi.stubGlobal('IDBKeyRange', IDBKeyRange);
  const f = await fixture();
  const id = useInterview.getState().sessionId!;
  for (let i = 0; i < 5; i++) {
    f.emit({ type: 'segment', segment: { id: String(i), source: 'system', text: '句' + i,
      final: i !== 4, startMs: i * 1000, endMs: i * 1000 + 100 } });
  }
  const generate = vi.spyOn(mockAI, 'streamAnswer').mockImplementation(async (_, send) => {
    send('已'); send('完成');
  });
  try { await useInterview.getState().ask('问题'); } finally { generate.mockRestore(); }
  expect(await recoverInterviewDrafts()).toBe(false);
  expect(await historyRepository.list()).toEqual([]);
  // Dropping the renderer's owner without end()/beforeunload leaves only its committed rows.
  useInterview.setState({ sessionId: null });
  await navigator.locks.request('voxcue-interview-drafts' + id, () => {});
  vi.stubGlobal('indexedDB', new IDBFactory());
  expect(await recoverInterviewDrafts()).toBe(false);
  vi.stubGlobal('indexedDB', ownerDatabase);
  expect(await recoverInterviewDrafts()).toBe(true);
  const [record] = await historyRepository.list();
  expect(record).toMatchObject({ id, status: 'interrupted', answers: [{ content: '已完成', status: 'completed' }] });
  expect(record.transcripts.map(row => row.text)).toEqual(['句0', '句1', '句2', '句3']);
  expect(await recoverInterviewDrafts()).toBe(false);
  useInterview.setState({ status: 'ended' });
  useInterview.getState().start();
  const recordingId = useInterview.getState().sessionId!;
  useInterview.setState({ hadRecording: true });
  useInterview.setState({ sessionId: null });
  await navigator.locks.request('voxcue-interview-drafts' + recordingId, () => {});
  expect(await recoverInterviewDrafts()).toBe(true);
  expect((await historyRepository.list()).find(row => row.id === recordingId)).toMatchObject({ status: 'interrupted' });
});
it('retains a complete archive on storage failure and clears the draft only after a successful retry', async () => {
  vi.stubGlobal('indexedDB', new IDBFactory());
  vi.stubGlobal('IDBKeyRange', IDBKeyRange);
  const f = await fixture();
  const id = useInterview.getState().sessionId!;
  f.emit({ type: 'segment', segment: { id: 'last', text: '尚未定稿', source: 'system',
    final: false, startMs: 0, endMs: 1000 } });
  const failure = vi.spyOn(historyRepository, 'save').mockRejectedValue(Error('storage full'));
  await useInterview.getState().end();
  useInterview.setState({ sessionId: null });
  await navigator.locks.request('voxcue-interview-drafts' + id, () => {});
  await expect(recoverInterviewDrafts()).rejects.toThrow('storage full');
  failure.mockRestore();
  expect(await recoverInterviewDrafts()).toBe(true);
  expect((await historyRepository.list())[0]).toMatchObject({ id, status: 'ended', transcripts: [{ text: '尚未定稿' }] });
  expect(await recoverInterviewDrafts()).toBe(false);
});
it('starts an unload checkpoint before the renderer disappears and recovers its interim text', async () => {
  vi.stubGlobal('indexedDB', new IDBFactory());
  vi.stubGlobal('IDBKeyRange', IDBKeyRange);
  vi.stubGlobal('localStorage', { getItem: () => null });
  const header = { id: 'unload', startedAt: 1, title: '面试' };
  const draft = startInterviewDraft(header, () => { throw Error('draft failed'); })!;
  const first = { id: 'first', time: '', text: '定稿', final: true };
  const interim = { id: 'interim', time: '', text: '最后半句', final: false };
  await draft.put(0, { transcript: first });
  draft.checkpoint({ ...header, endedAt: Date.now(), status: 'interrupted', mock: false,
    answers: [], transcripts: [first, interim] });
  await draft.close(false);
  expect(await recoverInterviewDrafts()).toBe(true);
  expect((await historyRepository.get(header.id))?.transcripts).toEqual([first, interim]);
});

it('serializes crashed-draft recovery with deletion and preserves the latest speech if deletion fails', async () => {
  vi.stubGlobal('indexedDB', new IDBFactory());
  vi.stubGlobal('IDBKeyRange', IDBKeyRange);
  const f = await fixture();
  const id = useInterview.getState().sessionId!;
  const say = (text: string) => f.emit({ type: 'segment', segment: {
    id: text, text, source: 'system', final: true, startMs: 0, endMs: 100,
  } });
  say('先保存');
  await useInterview.getState().archive('interrupted');
  say('后来定稿');
  expect(await useHistory.getState().remove(id)).toBe(false);
  useInterview.setState({ sessionId: null });
  await navigator.locks.request('voxcue-interview-drafts' + id, () => {});
  const recordings = vi.fn().mockRejectedValue(Error('stage failed'));
  Object.assign(window.desktop!, { recordings });
  expect(await useHistory.getState().remove(id)).toBe(false);
  expect((await historyRepository.list())[0].transcripts.map(row => row.text)).toEqual(['先保存', '后来定稿']);
  recordings.mockResolvedValue([]);
  const [, deleted] = await Promise.all([recoverInterviewDrafts(), useHistory.getState().remove(id)]);
  expect(deleted).toBe(true);
  expect(await recoverInterviewDrafts()).toBe(false);
  expect(await historyRepository.list()).toEqual([]);
});
it('serializes end requests, flushes the final tail and archives before completion', async () => {
  const f = await fixture();
  let release!: () => void;
  f.speech.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = () => resolve({ state: 'idle' as never, model: 'synthetic' });
      }),
  );
  const first = useInterview.getState().end();
  const second = useInterview.getState().end({ preserveEmpty: true, generateTitle: false });
  expect(f.speech).toHaveBeenCalledOnce();
  expect(await historyRepository.list()).toEqual([]);
  f.emit({
    type: 'segment',
    segment: {
      id: 'tail',
      source: 'system',
      text: '最后一段完整转写',
      final: true,
      startMs: 0,
      endMs: 1000,
      reason: 'stop',
    },
  });
  release();
  await Promise.all([first, second]);
  const records = await historyRepository.list();
  expect(records).toHaveLength(1);
  expect(records[0].status).toBe('ended');
  expect(records[0].transcripts[0].text).toBe('最后一段完整转写');
  expect(records[0].mock).toBe(false);
  expect(f.title).not.toHaveBeenCalled();
});
it('keeps an empty expired interview and saves the same session only once', async () => {
  await fixture();
  await useInterview.getState().end({ preserveEmpty: true, generateTitle: false });
  await useInterview.getState().end({ preserveEmpty: true, generateTitle: false });
  expect(await historyRepository.list()).toHaveLength(1);
  expect((await historyRepository.list())[0].transcripts).toEqual([]);
});
it.each(['event', 'reply'])('保存录音失败及正常转写的独立结局，重试不丢失且下场面试不继承（%s）', async source => {
  const f = await fixture();
  const recordingError = '录音写入失败，请检查可用空间。';
  if (source === 'event') f.emit({ type: 'recording', active: false, error: recordingError });
  else f.speech.mockResolvedValueOnce({ state: 'idle', model: 'synthetic', recordingError } as never);
  await useInterview.getState().end();
  await useInterview.getState().end();
  const [record] = await historyRepository.list();
  expect(record).toMatchObject({ status: 'interrupted', recordingError });
  expect(record.transcriptTailIncomplete).toBeUndefined();
  useInterview.getState().start();
  expect(useInterview.getState().recordingError).toBeNull();
});
it('closes after a failed final flush and retains the incomplete-tail marker when the archive is retried', async () => {
  const f = await fixture();
  f.speech.mockRejectedValueOnce(Error('语音尾段处理超时。'));
  await useInterview.getState().end();
  expect(useInterview.getState().status).toBe('ended');
  expect(useHistory.getState().error).toBeNull();
  expect((await historyRepository.list())[0]).toMatchObject({ status: 'interrupted', transcriptTailIncomplete: true });
  await useInterview.getState().end();
  expect((await historyRepository.list())[0].transcriptTailIncomplete).toBe(true);
  useInterview.getState().start();
  expect(useInterview.getState().transcriptTailIncomplete).toBe(false);
});
it('retains transcripts and answers on storage failure, then retries without duplicating the record', async () => {
  const f = await fixture();
  f.emit({
    type: 'segment',
    segment: {
      id: 'body',
      source: 'system',
      text: '面试内容',
      final: true,
      startMs: 0,
      endMs: 1000,
    },
  });
  const image = { id: '11111111-1111-4111-8111-111111111111' };
  useInterview.setState({
    generating: true,
    answers: [
      {
        id: 'answer',
        question: '问题',
        content: '已生成的回答',
        status: 'streaming',
        images: [image],
      },
    ],
  });
  f.fail(true);
  await useInterview.getState().end({ preserveEmpty: true, generateTitle: false });
  expect(useHistory.getState().error).toContain('记录保存失败');
  expect(useInterview.getState().transcripts).toHaveLength(1);
  expect(useInterview.getState().answers[0].content).toBe('已生成的回答');
  expect(await historyRepository.list()).toEqual([]);
  f.fail(false);
  await useInterview.getState().end({ preserveEmpty: true, generateTitle: false });
  expect(useHistory.getState().error).toBeNull();
  expect(await historyRepository.list()).toHaveLength(1);
  expect((await historyRepository.list())[0].answers[0].content).toBe('已生成的回答');
  expect((await historyRepository.list())[0].answers[0].status).toBe('stopped');
  expect((await historyRepository.list())[0].answers[0].images).toEqual([image]);
});

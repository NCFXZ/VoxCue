import { afterEach, expect, it, vi } from 'vitest';
import { useInterview } from '../../src/stores/interview';
import { useHistory } from '../../src/stores/history';
import { localHistory } from '../../src/services/history';
import type { SpeechEvent } from '../../electron/contracts/speech';

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
  expect(localHistory.list()).toEqual([]);
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
  const records = localHistory.list();
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
  expect(localHistory.list()).toHaveLength(1);
  expect(localHistory.list()[0].transcripts).toEqual([]);
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
  expect(localHistory.list()).toEqual([]);
  f.fail(false);
  await useInterview.getState().end({ preserveEmpty: true, generateTitle: false });
  expect(useHistory.getState().error).toBeNull();
  expect(localHistory.list()).toHaveLength(1);
  expect(localHistory.list()[0].answers[0].content).toBe('已生成的回答');
  expect(localHistory.list()[0].answers[0].status).toBe('stopped');
  expect(localHistory.list()[0].answers[0].images).toEqual([image]);
});

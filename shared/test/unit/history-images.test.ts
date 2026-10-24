import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useHistory } from '../../src/stores/history';
import { createHistoryService, type InterviewRecord } from '../../src/services/history';

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
  useHistory.getState().save(record('one', first));
  useHistory.getState().save(record('two', first));
  expect(await useHistory.getState().remove('one')).toBe(true);
  expect(cleanup).not.toHaveBeenCalled();
  expect(await useHistory.getState().remove('two')).toBe(true);
  expect(cleanup).toHaveBeenCalledWith({ op: 'remove', ids: [first] });
});

it('记录写入失败不删除原图；原图清理失败有明确提示', async () => {
  useHistory.getState().save(record('one', first));
  vi.spyOn(localStorage, 'setItem').mockImplementationOnce(() => {
    throw Error('full');
  });
  expect(await useHistory.getState().remove('one')).toBe(false);
  expect(cleanup).not.toHaveBeenCalled();
  cleanup.mockResolvedValue({ ok: false, error: { message: 'disk failed' } });
  expect(await useHistory.getState().remove('one')).toBe(true);
  expect(useHistory.getState().error).toContain('截图清理失败');
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

import { describe, it, expect } from 'vitest';
import { SampleBuffer, PacketDecoder } from '../electron/backend/speech/buffer';
import { validateSpeech } from '../electron/backend/speech/validation';
import { QuestionBuffer } from '../src/services/speech';
describe('本地语音边界和问题汇总', () => {
  it('环形缓存跨边界保持顺序，满时显式失败', () => {
    const b = new SampleBuffer(4);
    b.push(new Float32Array([1, 2, 3]));
    expect([...b.take(2)]).toEqual([1, 2]);
    b.push(new Float32Array([4, 5, 6]));
    expect(() => b.push(new Float32Array([7]))).toThrow();
    expect([...b.take(4)]).toEqual([3, 4, 5, 6]);
  });
  it('半包、粘包和时间戳解码一致，拒绝超大包', () => {
    const p = Buffer.alloc(25);
    p.writeUInt32LE(21, 0);
    p[4] = 1;
    p.writeUInt32LE(48000, 5);
    p.writeDoubleLE(123.25, 9);
    p.writeUInt32LE(2, 17);
    p.writeFloatLE(0.25, 21);
    const d = new PacketDecoder();
    expect(d.push(p.subarray(0, 11))).toEqual([]);
    expect(
      d
        .push(Buffer.concat([p.subarray(11), p]))
        .map((x) => ({ rate: x.rate, time: x.timestamp, sample: x.samples[0] })),
    ).toEqual([
      { rate: 48000, time: 123.25, sample: 0.25 },
      { rate: 48000, time: 123.25, sample: 0.25 },
    ]);
    expect(() => new PacketDecoder().push(Buffer.from([255, 255, 255, 255]))).toThrow();
  });
  it('来源白名单、数量、重复、设备长度受控，无路径透传', () => {
    for (const v of [
      null,
      { op: 'start', options: { sources: [] } },
      { op: 'start', options: { sources: ['system', 'system'] } },
      { op: 'start', options: { sources: ['secret'] } },
      { op: 'start', options: { sources: ['system'], system: 'x'.repeat(513) } },
    ])
      expect(() => validateSpeech(v)).toThrow();
    expect(
      validateSpeech({ op: 'start', options: { sources: ['microphone'], path: 'secret' } }),
    ).toEqual({ op: 'start', options: { sources: ['microphone'] } });
  });
  it('临时文本不入问题、终稿去重、跨短停顿合并、双路独立消费', () => {
    const q = new QuestionBuffer();
    const segment = {
      id: '1',
      source: 'system' as const,
      text: '请介绍',
      final: false,
      startMs: 0,
      endMs: 500,
    };
    expect(q.add(segment)).toBe(false);
    q.add({ ...segment, final: true });
    expect(q.add({ ...segment, final: true })).toBe(false);
    q.add({ ...segment, id: '2', text: '机器人项目', final: true });
    q.add({ ...segment, id: '3', source: 'microphone', text: '我的回答', final: true });
    expect(q.consume('system')).toBe('请介绍 机器人项目');
    expect(q.consume('system')).toBe('');
    expect(q.text('microphone')).toBe('我的回答');
    q.clear();
    expect(q.add({ ...segment, final: true })).toBe(true);
  });
  it('超长问题不能静默截断后发送', () => {
    const q = new QuestionBuffer();
    q.add({
      id: '1',
      source: 'system',
      text: '字'.repeat(6001),
      final: true,
      startMs: 0,
      endMs: 1000,
    });
    expect(() => q.consume('system')).toThrow('6000');
  });
});

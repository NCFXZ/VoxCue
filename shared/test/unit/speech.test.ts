import { describe, it, expect } from 'vitest';
import { SampleBuffer, PacketDecoder } from '../../../shared/electron/backend/speech/buffer';
import { validateSpeech } from '../../../shared/electron/backend/speech/validation';
import { QuestionBuffer } from '../../../shared/src/services/speech';
const buffered = (text: string) => {
  const buffer = new QuestionBuffer();
  buffer.add({ id: 'original', text, source: 'system', final: true, startMs: 0, endMs: 10 });
  return buffer.consume('system');
};
describe('本地语音边界和问题汇总', () => {
  it.each([
    '嗯',
    '好的。',
    '嗯 好的 谢谢',
    '明白了，谢谢您。',
    'OK, thank you!',
    'Got it.',
    'THANK YOU VERY MUCH',
    '嗯嗯嗯',
    '呃呃，嗯嗯，好好好',
    '嗯好的谢谢',
    '哦哦好的明白了',
    '嗯\t嗯\n好的',
    'ＯＫ，ＴＨＡＮＫＳ！',
  ])('明确回应 %s 与普通终稿一样进入问题缓冲', (text) => {
    expect(buffered(text)).toBe(text);
  });
  it.each([
    '讲讲你的项目',
    '继续',
    '为什么',
    '可以吗',
    '明白了吗？',
    '好的？',
    '好在哪里',
    '不对，我刚才说的是 PostgreSQL',
    '谢谢，请继续解释索引',
    '嗯，具体如何实现',
    'Thanks. Explain the trade-off.',
    'Yes',
    'No',
    'I see a race condition',
    '',
    '```\n好的\n```',
    'Thank you for the explanation; why not Redis?',
    '嗯那为啥这么选',
    '呃就是那个PostgreSQL咋保证一致性的',
    '好好学习这个方案有什么坑',
    '嗯嗯没听清再说一遍',
    '谢谢不过为啥不用Redis呢',
    '哦我刚说岔了是异步不是同步',
    '嗯嗯嗯？',
    '好的\n为什么',
    'uh so why postgres instead of redis',
    'got it but what happens on failure',
    '嗯你你你再把刚刚那个讲一下',
    '额破斯格瑞那个数据库咋扩容',
    '嗯post gree SQL要咋调优',
    '嗯'.repeat(121),
  ])('不确定、追问、指令和纠正 %s 继续交给模型', (text) => {
    expect(buffered(text)).toBe(text);
  });
  it('组合语气词、重复词和无标点不能吞掉夹在中间的有效内容', () => {
    const acknowledgements = ['嗯', '呃呃', '哦哦', '好的', '明白了', '谢谢', 'OK', 'got it'];
    const questions = [
      '为啥',
      '咋整',
      '继续',
      '不对',
      '没听清',
      '重来一遍',
      '说岔了是SQLite',
      '你你你再讲讲',
      'why',
      'not Redis',
    ];
    const separators = ['', ' ', '，', '\n'];
    for (const before of acknowledgements)
      for (const after of acknowledgements)
        for (const question of questions)
          for (const separator of separators) {
            const text = [before, question, after].join(separator);
            expect(buffered(text), text).toBe(text);
          }
  });
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
  it.each([NaN, Infinity, -Infinity])(
    '损坏采样 %s 在音频管道边界被拒绝，不进入重采样与识别',
    (sample) => {
      const packet = Buffer.alloc(25);
      packet.writeUInt32LE(21, 0);
      packet[4] = 1;
      packet.writeUInt32LE(16000, 5);
      packet.writeDoubleLE(1000, 9);
      packet.writeFloatLE(sample, 21);
      expect(() => new PacketDecoder().push(packet)).toThrow('Invalid audio sample');
    },
  );
  it('来源白名单、数量、重复、设备长度受控，无路径透传', () => {
    for (const v of [
      null,
      { op: 'start', options: { sources: [] } },
      { op: 'start', options: { sources: ['system', 'system'] } },
      { op: 'start', options: { sources: ['secret'] } },
      { op: 'start', options: { sources: ['system'], asrModel: 'C:/untrusted-model' } },
      { op: 'start', options: { sources: ['system'], computeDevice: 'cuda --command' } },
      { op: 'start', options: { sources: ['system'], computeDevice: 'nvidia' } },
      { op: 'start', options: { sources: ['system'], system: 'x'.repeat(513) } },
    ])
      expect(() => validateSpeech(v)).toThrow();
    expect(() => validateSpeech({ op: 'models' })).toThrow();
    expect(() =>
      validateSpeech({ op: 'start', options: { sources: ['microphone'], path: 'secret' } }),
    ).toThrow();
    expect(validateSpeech({ op: 'start', options: { sources: ['system'] } })).toEqual({
      op: 'start',
      options: { sources: ['system'] },
    });
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

import type { InterviewRecord } from './history';
export const historyExamples: InterviewRecord[] = [
  {
    id: 'example-frontend',
    title: '前端开发工程师 · 项目经历练习',
    startedAt: new Date('2026-10-12T10:00:00+08:00').getTime(),
    endedAt: new Date('2026-10-12T10:25:00+08:00').getTime(),
    status: 'ended',
    mock: true,
    transcripts: [
      {
        id: 'example-t1',
        text: '介绍一个你负责过的项目，以及你在其中的具体职责。',
        time: '10:01:20',
        final: true,
      },
    ],
    answers: [
      {
        id: 'example-a1',
        question: '介绍一个你负责过的项目，以及你在其中的具体职责。',
        content:
          '这是模拟记录示例，并非真实面试。\n\n可以按照「背景 → 职责 → 行动 → 结果」组织项目经历：\n\n先说明项目要解决的问题，再描述你的个人贡献和技术决策，最后用真实的数据说明结果。',
      },
    ],
  },
  {
    id: 'example-introduction',
    title: '自我介绍 · 表达结构练习',
    startedAt: new Date('2026-10-11T15:00:00+08:00').getTime(),
    endedAt: new Date('2026-10-11T15:12:00+08:00').getTime(),
    status: 'ended',
    mock: true,
    transcripts: [
      { id: 'example-t2', text: '请用一分钟介绍一下自己。', time: '15:00:30', final: true },
    ],
    answers: [
      {
        id: 'example-a2',
        question: '请用一分钟介绍一下自己。',
        content:
          '这是模拟记录示例。\n\n用一句话介绍专业方向；用一个项目突出相关经历；最后说明你与目标岗位的匹配之处。',
      },
    ],
  },
];

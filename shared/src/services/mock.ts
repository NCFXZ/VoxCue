import type { AIModelService, SpeechRecognitionService } from './contracts';
export function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new DOMException('Aborted', 'AbortError'));
    const cancel = () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', cancel);
      resolve();
    }, ms);
    signal.addEventListener('abort', cancel, { once: true });
  });
}
const questions = [
  '请先简单介绍一下自己，以及你最有代表性的一个项目。',
  '在这个项目中，你遇到过什么技术挑战？你是如何解决的？',
  '如果项目需求突然发生变化，你会如何调整计划并与团队沟通？',
];
export const createMockSpeech = (startIndex = 0): SpeechRecognitionService => ({
  async start(onTranscript, signal) {
    for (const question of questions.slice(startIndex)) {
      for (let end = 3; end < question.length + 3; end += 3) {
        await wait(180, signal);
        onTranscript(question.slice(0, end), end >= question.length);
      }
      await wait(14000, signal);
    }
  },
});
export const mockAI: AIModelService = {
  async streamAnswer(question, onChunk, signal) {
    const answer = question.includes('挑战')
      ? '可以用 STAR 结构组织回答：\n\n1. 情境：项目进入交付阶段，页面响应速度未达到预期。\n2. 任务：定位性能瓶颈，同时保证现有功能稳定。\n3. 行动：通过性能分析拆分问题，优化重复请求和组件渲染，并与团队确认验收指标。\n4. 结果：用实际测量数据说明改进效果，再补充你从中学到的方法。\n\n结合你的真实经历替换细节，突出你独立做出的判断。'
      : question.includes('变化')
        ? '建议先澄清变化的目标与优先级，再评估影响：\n\n• 明确哪些需求必须在本轮交付。\n• 与团队一起评估工作量、依赖和风险。\n• 给出调整范围或交付时间的方案。\n• 记录决策，定期同步进展。\n\n可以补充一个真实案例，说明你如何让相关人员形成共识。'
        : '建议按「背景 → 项目 → 个人贡献 → 岗位匹配」展开，控制在 1–2 分钟。\n\n你好，我主要关注前端工程与用户体验。在最近的一个项目中，我负责核心交互页面的设计与实现，使用 React 和 TypeScript 拆分可复用组件，并与团队一起完成需求验证。\n\n最有代表性的部分是把复杂流程整理成清晰的操作路径。我会结合实际项目说明自己的技术决策、遇到的困难，以及最终取得的结果。\n\n回答提示：用你的真实经历和数据替换示例，突出与你应聘岗位相关的能力。';
    for (let i = 0; i < answer.length; i += 3) {
      await wait(35, signal);
      onChunk(answer.slice(i, i + 3));
    }
  },
};

import { wait } from './mock';
import type { ChatRequestOptions } from './chatOptions';
import type { ChatSource, TokenUsage } from '../../electron/contracts/chat';
import type { PersonalInfo } from '../../electron/contracts/profile';
export type { PersonalInfo } from '../../electron/contracts/profile';
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  reasoningSummary?: string;
  changes?: Partial<PersonalInfo>;
  profilePreview?: import('../../electron/contracts/profile').ProfilePreview;
  applied?: boolean;
  dismissed?: boolean;
  profileBase?: PersonalInfo;
  options?: ChatRequestOptions;
  mode?: 'live' | 'mock';
  provider?: string | import('../../electron/contracts/chat').ModelProvider;
  activity?: import('../../electron/contracts/chat').ChatActivity;
  activities?: import('../../electron/contracts/chat').ChatActivity[];
  startedAt?: number;
  durationMs?: number;
  sources?: ChatSource[];
  usage?: TokenUsage | null;
  status?: 'streaming' | 'completed' | 'stopped' | 'failed';
  error?: string;
  errorCode?: string;
}
export interface PreparationChatService {
  streamReply(
    prompt: string,
    info: PersonalInfo,
    onChunk: (text: string) => void,
    signal: AbortSignal,
    options?: ChatRequestOptions,
  ): Promise<void>;
}
export function extractProfileChanges(prompt: string): Partial<PersonalInfo> {
  const changes: Partial<PersonalInfo> = {};
  const name = prompt.match(/(?:^|\n)姓名[：:]\s*([^\n]+)/)?.[1]?.trim();
  const jd = prompt.match(/(?:^|\n)(?:JD|岗位描述|职位描述)[：:]\s*([\s\S]+)/i)?.[1]?.trim();
  if (name) changes.name = name.slice(0, 60);
  if (jd) changes.jobDescription = jd.slice(0, 10000);
  return changes;
}
export function needsProfileReview(prompt: string, attachmentCount: number) {
  return (
    attachmentCount > 0 ||
    /个人信息|个人资料|简历|履历|JD|职位描述|岗位描述|自定义指令|提示词|技能|面试语言|我叫|我的名字|以后.{0,20}(回答|请|用)|(?:更新|修改|添加|删除|补充|清空).{0,20}(?:指令|偏好|要求|风格|岗位|姓名|背景)|(?:姓名|目标岗位|岗位|职位)[：:]/i.test(
      prompt,
    )
  );
}
export function needsSkillResearch(prompt: string) {
  if (
    /(?:供|用于|以便)(?:确认后|之后|后续)?(?:联网)?(?:更新|生成)(?:面试)?技能/.test(prompt) &&
    /(?:补充|整理).{0,12}(?:简历|职位描述|JD)/i.test(prompt)
  )
    return false;
  return /(?:生成|更新|重做|补充|添加|整理|完善|修改|做一套).{0,20}(?:技能|面试知识|知识点)|(?:技能|面试知识|知识点).{0,20}(?:生成|更新|重做|补充|添加|整理|完善|修改)/.test(
    prompt,
  );
}
export const mockPreparation: PreparationChatService = {
  async streamReply(prompt, info, onChunk, signal, options) {
    if (options) {
      const notes = [
        options.webSearch ? '网络搜索已开启（模拟）：尚未联网检索，不提供实时搜索结果。' : '',
        options.attachments.length
          ? `已收到 ${options.attachments.length} 个本地附件（模拟）：尚未上传或解析文件内容。`
          : '',
        options.modelId === 'mock-reasoning' ? '当前选择推理模型（模拟），以下仍为预设回复。' : '',
      ].filter(Boolean);
      if (notes.length) onChunk(notes.join('\n') + '\n\n');
    }
    const changes = extractProfileChanges(prompt);
    const answer = Object.keys(changes).length
      ? '我识别到了你提供的资料信息。你可以检查下方内容，再点击“确认更新”保存到本机。\n\n这是一条模拟回复，仅识别明确标注的姓名和 JD。其他经历可在右上角“个人信息”中编辑。'
      : /简历|履历/.test(prompt)
        ? '我们可以先从简历的表达结构入手：\n\n1. 用一句话概括你的专业方向与目标岗位。\n2. 每段项目经历依次写清背景、你的职责、关键行动和结果。\n3. 优先保留与目标岗位相关的经历，使用真实数据说明贡献。\n\n你可以通过输入框左下角上传简历，或把需要修改的段落粘贴给我。\n\n当前为 Mock 演示：文件只保存在本机，PDF 和 Word 解析、AI 简历分析尚未接入。'
        : /项目/.test(prompt)
          ? `可以围绕${info.role ? `「${info.role}」岗位` : '你的目标岗位'}准备一个 2 分钟的项目介绍：\n\n• 为什么做：项目背景与要解决的问题。\n• 你做了什么：你的职责、技术选择及原因。\n• 最难的部分：具体挑战与你采取的行动。\n• 最终结果：真实成果、数据与复盘。\n\n把项目背景和你负责的部分发给我，我们可以继续练习。以上为预设的模拟建议。`
          : /介绍|准备/.test(prompt)
            ? `${info.name ? `${info.name}，` : ''}我们先把面试准备拆成三个步骤：\n\n1. 补充个人信息：教育背景、工作经历和目标岗位。\n2. 上传简历，整理与岗位相关的项目素材。\n3. 准备自我介绍与常见问题，练习清晰表达。\n\n${info.role ? `你当前的目标岗位是「${info.role}」。` : '可以在右上角“个人信息”填写目标岗位。'}\n\n当前为模拟聊天，不会发起实际面试或写入面试记录。`
            : '我收到了你的问题。我们可以一起梳理面试准备思路、简历表达和项目经历。\n\n你可以告诉我你的目标岗位，以及现在最想改善的一部分；也可以用“岗位：…”和“JD：…”的格式提供更新信息。\n\n这是一条预设的 Mock 回复，尚未连接真实 AI 服务。';
    for (let i = 0; i < answer.length; i += 4) {
      await wait(25, signal);
      onChunk(answer.slice(i, i + 4));
    }
  },
};

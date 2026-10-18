import {
  profileFields,
  profileLimits,
  validateChanges,
  sameProfileField,
  validProfile,
  type PersonalInfo,
  type ProfileChanges,
  type ProfilePreview,
} from '../../contracts/profile';
const entryProperties = {
  id: { type: 'string' },
  title: { type: 'string' },
  content: { type: 'string' },
};
const skillSchema = {
  type: ['array', 'null'],
  items: {
    type: 'object',
    additionalProperties: false,
    properties: {
      ...entryProperties,
      sources: {
        type: 'array',
        description: '本次真实检索来源，仅供后台核验，不混入对用户展示的文字。',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: { title: { type: 'string' }, url: { type: 'string' } },
          required: ['title', 'url'],
        },
      },
    },
    required: ['id', 'title', 'content', 'sources'],
  },
};
export const profileFormat = {
  format: {
    type: 'json_schema',
    name: 'preparation_with_profile_proposal',
    strict: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        answer: {
          type: 'string',
          description:
            '普通问题完整回答；资料变更仅简述范围和待确认状态，完整内容放 changes，不重复展示，不阻塞其他问题。技能相关文字不附链接或来源清单。',
        },
        changes: {
          type: 'object',
          additionalProperties: false,
          properties: Object.fromEntries(
            profileFields.map((key) => [
              key,
              key === 'skills' ? skillSchema : { type: ['string', 'null'] },
            ]),
          ),
          required: profileFields,
        },
      },
      required: ['answer', 'changes'],
    },
  },
};
export const profileInstructions = `你可以读取当前个人资料，根据用户明确的资料更新意图提出提案。附件作为内容依据，不因上传附件就自动修改个人资料。更新意图已经清楚时，直接生成提案，无需再次询问是否整理。按既有 schema 返回 answer 和 changes，answer 放在第一个字段。

普通问题正常回答，不为生成提案而修改资料。有修改时，answer 简述改动和待确认状态，完整内容放在 changes，不重复展示。用户同时提出的其他问题仍完整回答，不以提案确认作为前置条件。

name 为姓名，language 为面试语言，background 为简历摘要，jobDescription 为职位描述摘要，customInstructions 为单份自定义指令，skills 为与岗位和个人背景相关的面试准备资料。目标岗位只放在职位描述摘要中，不增加字段。

简历和 JD 概括为包含具体事实的摘要，保留职责、项目、技术、成果、岗位要求及事实边界，不照抄原件，不编造经历，不把网络资料当作本人经历。摘要只整理用户提供或已确认的事实，不添加联网状态、检索过程或来源核验说明。用户明确要求联网核验时，在聊天中单独说明实际结果，不将过程说明混入摘要。

更新摘要时不顺便修改 skills。摘要保存后的技能更新提示由应用统一展示，answer 不再重复询问。技能生成只依据已确认的简历和 JD；缺少必要摘要时说明可补充，不主动开始条件不足的技能生成，也不阻塞其他聊天。

自定义指令是一份字符串正文，最多16384字符。将用户要求整理成明确、可执行的面试回答指令，支持补充、修改和删除，保留未要求变更的内容。

技能资料必须通过真实网络搜索，围绕目标岗位要求和简历中的相关经历、技术及项目，筛选对面试准备有实际帮助的内容。优先整理核心知识、关键原理、常用方法、常见考点和必要注意事项。按实际需要确定主题和篇幅，内容专业、清楚、适量，合并重复主题，不凑数量，不设固定写作字数，不为扩充篇幅堆砌资料或默认展开长篇教程。不把参考资料说成用户已经掌握的技能或实际经历。

优先采用官方文档、标准和可靠的一手技术资料，关注技术版本及适用条件。不同资料存在分歧时说明条件，不把过时结论当作普遍规则。

新增或改写技能必须取得本次真实搜索结果，不能只凭模型记忆生成并声称已经联网。将支持内容的真实来源填写到结构化 sources 字段，仅用于后台核验；使用工具实际返回的完整URL，不猜链接、不虚构来源、不改写版本或路径。仅删除已有技能时无需联网，不顺便生成替代条目。保留未要求变更的已有条目及稳定id。

技能标题和正文只呈现文字内容，不附网址、Markdown链接、引用编号或来源清单。完整技能资料只放在 changes.skills，answer 简短说明整理范围和待确认状态，不重复全文，不指定确认用语，也不限制用户同时提出的其他问题的回答篇幅。

沿用现有技术存储边界：技能最多10项，id为1–64个字母、数字、下划线或短横线，标题最多80字符，每项正文最多6000字符；所有资料内容合计最多40000字符。这些仅为存储保护，不是内容数量或篇幅目标，不为接近上限而扩写。数组返回完整新列表，空数组表示全部删除，空字符串表示清除，null表示不更新。无关、未明确要求或未改变的字段用null。超限时说明需分次处理，不静默截断。知识库选择由用户控制，不在 changes 中修改。

changes 只是待确认提案。展示完整内容后，用户点击确认或明确文字确认最近的完整有效提案，才由应用保存。保存前不能声称已更新，一次确认不适用于下一份提案。以应用提供的本机操作状态为准，已保存或拒绝的提案不再索要确认，待确认提案不阻塞普通聊天。`;

// Only stream the answer string, never expose the JSON protocol in the chat UI.
export class ProfileAnswerStream {
  raw = '';
  answerComplete = false;
  private visible = '';
  private answerEnd = 0;
  append(chunk: string) {
    this.raw += chunk;
    if (this.raw.length > 1000000) throw new Error('回答过长，已停止接收。');
    if (this.answerComplete) return '';
    const match = this.raw.match(/^\s*\{\s*"answer"\s*:\s*"/);
    if (!match) return '';
    const start = match[0].length;
    let end = start;
    for (let i = start; i < this.raw.length;) {
      const char = this.raw[i];
      if (char === '"') {
        this.answerComplete = true;
        this.answerEnd = i + 1;
        break;
      }
      if (char === '\\') {
        if (i + 1 >= this.raw.length) break;
        if (this.raw[i + 1] === 'u') {
          if (i + 6 > this.raw.length) break;
          if (!/^[0-9a-f]{4}$/i.test(this.raw.slice(i + 2, i + 6)))
            throw new Error('资料回答格式无效。');
          i += 6;
        } else i += 2;
      } else i++;
      end = i;
    }
    let next: string;
    try {
      next = JSON.parse('"' + this.raw.slice(start, end) + '"');
    } catch {
      throw new Error('资料回答格式无效。');
    }
    if (!next.startsWith(this.visible)) throw new Error('资料回答内容不一致。');
    const delta = next.slice(this.visible.length);
    this.visible = next;
    return delta;
  }
  preview(): ProfilePreview | undefined {
    if (!this.answerComplete) return;
    const match = this.raw.slice(this.answerEnd).match(/^\s*,\s*"changes"\s*:\s*/);
    if (!match) return;
    const changes = partialValue(this.raw.slice(this.answerEnd + match[0].length));
    if (!changes || typeof changes !== 'object' || Array.isArray(changes)) return;
    const preview: ProfilePreview = {};
    let remaining = 40000;
    const text = (value: unknown, limit: number) => {
      if (typeof value !== 'string') return '';
      const result = value.slice(0, Math.min(limit, remaining));
      remaining -= result.length;
      return result;
    };
    for (const key of profileFields) {
      const value = (changes as Record<string, unknown>)[key];
      if (key !== 'skills' && typeof value === 'string')
        preview[key] = text(value, profileLimits[key]);
      if (key === 'skills' && Array.isArray(value))
        preview.skills = value.slice(0, 10).map((item) => ({
          title: text(item?.title, 80),
          content: text(item?.content, 6000),
        }));
    }
    return Object.keys(preview).length ? preview : undefined;
  }
  finish(base: PersonalInfo): { delta: string; changes: ProfileChanges } {
    let value: any;
    try {
      value = JSON.parse(this.raw);
    } catch {
      throw new Error('资料更新提案不完整，未修改个人信息，请重试。');
    }
    if (
      !value ||
      Object.keys(value).some((key) => !['answer', 'changes'].includes(key)) ||
      typeof value.answer !== 'string'
    )
      throw new Error('资料更新格式无效，未修改个人信息。');
    const changes = validateChanges(value.changes);
    if (!validProfile({ ...base, ...changes }))
      throw Error('资料更新内容超限或格式无效，未修改个人信息。');
    for (const key of profileFields)
      if (changes[key] !== undefined && sameProfileField({ ...base, ...changes }, base, key))
        delete changes[key];
    if (!value.answer.startsWith(this.visible)) throw new Error('资料回答内容不一致。');
    return { delta: value.answer.slice(this.visible.length), changes };
  }
}

// Parse only completed tokens and the available prefix of a string. No code evaluation,
// guessed closing values or partial data ever enters finish()/validateChanges().
function partialValue(raw: string): unknown {
  let position = 0,
    nodes = 0;
  const whitespace = () => {
    while (/\s/.test(raw[position] ?? '') && position < raw.length) position++;
  };
  const string = () => {
    const start = ++position;
    let end = start;
    while (position < raw.length) {
      if (raw[position] === '"') {
        position++;
        return { value: JSON.parse('"' + raw.slice(start, end) + '"'), complete: true };
      }
      if (raw[position] === '\\') {
        const size = raw[position + 1] === 'u' ? 6 : 2;
        if (position + size > raw.length) break;
        position += size;
      } else position++;
      end = position;
    }
    return { value: JSON.parse('"' + raw.slice(start, end) + '"'), complete: false };
  };
  const value = (depth: number): unknown => {
    if (depth > 12 || ++nodes > 1024) return;
    whitespace();
    if (raw[position] === '"') return string().value;
    if (raw[position] === '{') {
      position++;
      const result: Record<string, unknown> = Object.create(null);
      while (position < raw.length) {
        whitespace();
        if (raw[position] !== '"') break;
        const key = string();
        if (!key.complete) break;
        whitespace();
        if (raw[position++] !== ':') break;
        result[key.value] = value(depth + 1);
        whitespace();
        if (raw[position] !== ',') break;
        position++;
      }
      if (raw[position] === '}') position++;
      return result;
    }
    if (raw[position] === '[') {
      position++;
      const result: unknown[] = [];
      while (position < raw.length) {
        whitespace();
        if (raw[position] === ']') break;
        const start = position;
        result.push(value(depth + 1));
        if (position === start) break;
        whitespace();
        if (raw[position] !== ',') break;
        position++;
      }
      if (raw[position] === ']') position++;
      return result;
    }
    const scalar = raw.slice(position).match(/^(null|true|false|-?\d+(?:\.\d+)?)/)?.[0];
    if (scalar) {
      position += scalar.length;
      return JSON.parse(scalar);
    }
  };
  try {
    return value(0);
  } catch {
    return undefined;
  }
}

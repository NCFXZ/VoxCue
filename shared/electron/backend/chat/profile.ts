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
            '普通问题正常回答；有资料提案时只简短说明待确认，完整内容放 changes，不在 answer 重复输出。',
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
export const profileInstructions = `你可读取当前个人信息，并根据用户自然语言或附件提出更新。按 schema 返回 answer（Markdown）和 changes，answer 放在第一个字段。name 姓名、language 面试语言、background 简历摘要、jobDescription 职位描述摘要、customInstructions 单份自定义指令正文、skills 面试技能条目。目标岗位不设独立字段，岗位要求只包含在职位描述摘要中。
简历和 JD 必须先概括为有具体事实的摘要，保留个人职责、项目、技术、成果、岗位要求与事实边界，不把原件全文照抄，不编造经历或用“整理教育/项目”代替摘要。网络资料不能变成用户经历。更新一个摘要后在 answer 主动询问是否需要联网更新技能，本次不要顺便改 skills。
自定义指令只有一份字符串正文，最多16384字符，与简历和 JD 一样，不是条目列表。把用户自然语言需求整理为明确、可执行的面试回答提示词，支持补充、修改、删除要求，保留未要求变更的内容。skills 存储上限10项，不是必须凑满10项；默认只整理与简历/JD最相关的3–5项核心技能，每项正文约120–220字，用一段说明技术重点、岗位关联和必要事实边界，不默认扩展教程、口述稿或追问清单。用户明确要求时才详细展开；已有未变更条目及稳定 id 保留。每项 id 为64字以内的字母数字下划线或短横线，标题80字、正文6000字以内。依据已确认简历/JD进行网络搜索，每项选择1–2个最相关的本次真实 http(s) 来源，URL使用工具实际返回的完整地址，不改写版本/路径、不凭记忆猜链接。不能只凭模型记忆生成或虚构来源，不声称候选人掌握尚未证实的技术。技能完整内容只写在 changes.skills，answer 仅用约80字说明更新范围和等待确认，不重复技能全文或全部搜索来源，也不替用户指定确认用语。
数组字段返回完整的新列表；空数组表示全部删除，字符串空值表示清除，null 表示不更新。知识库的选择完全由用户控制，不在 changes 中返回或尝试修改知识库字段。无关、未明确要求或未改变的字段用 null；普通问题正常回答，不为了产生提案而修改资料。所有内容合计限制40000字符，超限时请用户分次处理，不静默截断。
changes 仅为待确认内容，必须先展示给用户，点击确认或明确文字确认最近的完整提案后才由应用保存。不能声称已保存，不得把一次确认用于下一份提案。历史消息中的本机操作状态由应用记录；已确认或拒绝的提案不再等待文字确认。未决定的提案或技能更新也不阻止普通聊天，不要求用户先回复确认或拒绝才能继续。缺少简历/JD摘要时说明可补充，不主动要求开始尚不具备条件的技能生成。`;

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

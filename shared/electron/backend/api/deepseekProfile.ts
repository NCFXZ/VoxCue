import type { PersonalInfo, ProfileChanges, ProfileGeneration, ProfilePreview } from '../../contracts/profile';
import { record } from '../chat/models';
import { ProfileOutputError, resolveProposal, streamedProfilePreview, type SkillScope } from '../chat/profile';
import type { ProfilePreviewSource } from '../chat/profilePreviews';

// DeepSeek web tools only accept text output, so preparation replies use a text protocol:
// a mandatory intent line, the visible Markdown answer, then an optional tagged proposal.
const intents = { none: '<profile_intent>none</profile_intent>', proposal: '<profile_intent>proposal</profile_intent>' };
const proposalOpen = '<profile_proposal>';
const proposalClose = '</profile_proposal>';
const markerStarts = ['<profile_', '</profile_'];
const fenceOpening = /^\s*```[ \t]*(?:json)?[ \t]*\r?\n/i;
const fenceClosing = /\r?\n[ \t]*```\s*$/;

const proposalExample = [
  intents.proposal,
  '已生成职位描述的修改提案，确认保存前资料保持原值。',
  proposalOpen,
  '{"changes":{"jobDescription":"硬件工程师"},"skillScope":null}',
  proposalClose,
].join('\n');

export const deepSeekProfileInstructions = `

DeepSeek 输出协议（优先于前文关于 JSON、schema 以及 answer、changes、skillScope 输出位置的要求；前文的意图判断、字段含义、摘要、技能、来源和确认规则仍然适用）：
1. 每次回复的第一行只写意图标记，前面不能有任何文字：本轮不提出资料修改时写 ${intents.none}；本轮提出资料修改提案时写 ${intents.proposal}。历史助手消息只保留了正文，标记和提案块已由应用移除，本轮仍须按本协议输出。
2. 标记后换行，直接写给用户看的 Markdown 回答正文（即前文的 answer），不放进 JSON 或代码围栏。普通咨询、分析、草稿和建议使用 none，不为回答问题而修改资料。
3. 只有 proposal 才在正文后另起一行写 ${proposalOpen}，接一个 JSON 对象 {"changes":{...},"skillScope":null}，再写 ${proposalClose} 结束回复。changes 只放本轮要修改的字段，值为该字段完整的新内容，未修改的字段省略；空字符串表示清空；skills 为完整新列表，每项为 {"id","title","content","sources":[{"title","url"}]}。skillScope 取 "all"、"topic" 或 null，与 changes 同级，不放进 changes；来源只写在每条技能自身的 sources 中。none 时不得输出 ${proposalOpen}。
4. 提案只是待确认的修改，用户在卡片中点击“保存所选”之前资料保持原值。正文只能说已生成待确认的提案，不能说资料已经更新或保存；没有写进本轮 ${proposalOpen} 的字段，不能声称已提出修改或已有卡片。
5. 多轮对话以最新一条用户消息为准。历史助手消息末尾的“本机操作状态”由应用写入，是该轮提案卡片实际状态的唯一依据；没有这一标注的历史回答没有可操作的提案卡片，其中关于修改、提案或卡片的说法均不代表实际状态。之前的提案无论待确认、已保存还是已拒绝，都不阻止新的修改：用户给出新值、再次修改同一字段或要求改回原值时，本轮直接给出完整的新提案，不让用户去操作之前的卡片，也不以“已经提交过”为由拒绝。用户只要求取消或不保存尚未保存的提案时使用 none，说明不保存即保持原值；用户只要求保存时，若对应提案仍待确认，使用 none 提示在该卡片勾选并点击“保存所选”，若没有仍待确认的对应卡片，则按此前明确的修改要求在本轮给出提案。
6. 最新请求否定或撤销的操作只取消对应字段，其他明确要求的修改仍放入本轮提案。例如“不要删 JD，把简历缩短一点”只修改 background。
示例（更新职位描述）：
${proposalExample}
示例（普通咨询）：
${intents.none}
（完整回答正文）`;

export const deepSeekProfileRecovery = `\n\n上一次尝试没有遵守 DeepSeek 输出协议，结果已丢弃。重新回答用户当前请求：第一行写 ${intents.none} 或 ${intents.proposal}，然后写 Markdown 正文；只有 proposal 才在最后写 ${proposalOpen}{"changes":{...},"skillScope":null}${proposalClose}，changes 只放本轮要修改且与当前资料不同的字段。根据用户的话和上下文判断意图，含义不清时使用 none 简短澄清。`;

function heldMarkerPrefix(text: string) {
  for (let size = Math.min(text.length, markerStarts[1].length - 1); size > 0; size--) {
    const tail = text.slice(-size);
    if (markerStarts.some(start => start.startsWith(tail))) return size;
  }
  return 0;
}

// Models writing JSON in text mode often keep raw line breaks inside strings. Escape only
// control characters inside string literals; structure and content stay exactly as written.
function escapeStringControls(raw: string) {
  let result = '', quoted = false, escaped = false;
  for (const char of raw) {
    const code = char.charCodeAt(0);
    if (quoted && !escaped && code < 0x20) {
      result += char === '\n' ? '\\n' : char === '\r' ? '\\r' : char === '\t' ? '\\t'
        : '\\u' + code.toString(16).padStart(4, '0');
      continue;
    }
    if (quoted && char === '\\' && !escaped) escaped = true;
    else {
      if (char === '"' && !escaped) quoted = !quoted;
      escaped = false;
    }
    result += char;
  }
  return result;
}

const proposalJson = (payload: string) => escapeStringControls(payload.replace(fenceOpening, ''));

// Sent as the final turn of a structure follow-up. The answer is already shown and is kept as is.
export const deepSeekStructureRequest = `【应用补充请求，不是用户发言】上一条助手回答已经展示给用户，但没有按 DeepSeek 输出协议可靠地标明本轮是否修改资料。请以此前最后一条用户消息、上下文和这条回答为依据判断：需要提出资料修改时，输出 ${intents.proposal}，并在其后给出完整的 ${proposalOpen}{"changes":{...},"skillScope":null}${proposalClose}，内容与已展示的回答一致；不需要修改资料时只输出 ${intents.none}。不要重复或改写回答正文。`;

const missingIntent = 'DeepSeek 没有标明本轮是否修改资料，个人信息未修改。';

export interface DeepSeekProfileResult {
  answerText: string;
  delta: string;
  changes: ProfileChanges;
  skillScope: SkillScope;
  /** The intent or proposal is unreliable; the answer stays valid, the structure must be asked again. */
  issue?: string;
}

// The caller bounds the total response length before appending. Structure problems never hide
// answer text: markers are removed, unexpected proposal blocks are skipped and the issue is kept.
export class DeepSeekProfileStream implements ProfilePreviewSource {
  generation?: ProfileGeneration;
  private intent?: keyof typeof intents;
  private phase: 'intent' | 'answer' | 'proposal' = 'intent';
  private pending = '';
  private visible = '';
  private block = '';
  private skipping = false;
  private payload?: string;
  private issue?: string;

  /** A structure follow-up only restates intent and proposal; any text in it is never shown. */
  constructor(private readonly structureOnly = false) {}

  get previewReady() {
    return !this.issue && this.intent === 'proposal' && this.payload !== undefined;
  }

  append(chunk: string) {
    this.pending += chunk;
    let output = '';
    while (true) {
      if (this.phase === 'intent' && !this.readIntent()) break;
      if (this.phase === 'answer') {
        const { text, done } = this.readAnswer();
        output += text;
        if (done) break;
      }
      if (this.phase === 'proposal' && !this.readProposal()) break;
    }
    if (!this.visible && output) output = output.trimStart();
    this.visible += output;
    return this.structureOnly ? '' : output;
  }

  private note(issue: string) {
    this.issue ??= issue;
  }

  private readIntent() {
    const text = this.pending.trimStart();
    const intent = (Object.keys(intents) as (keyof typeof intents)[]).find(key => text.startsWith(intents[key]));
    if (intent) {
      this.intent = intent;
      this.pending = text.slice(intents[intent].length);
    } else if (Object.values(intents).some(marker => marker.startsWith(text))) {
      return false;
    } else {
      this.note(missingIntent);
    }
    this.phase = 'answer';
    return true;
  }

  // Return visible answer text up to the next protocol marker. Hold a possible partial marker
  // and trailing whitespace, so the streamed text always equals the final trimmed answer.
  private readAnswer(): { text: string; done: boolean } {
    const at = this.pending.search(/<\/?profile_/);
    if (at < 0) {
      const end = this.pending.slice(0, this.pending.length - heldMarkerPrefix(this.pending)).trimEnd().length;
      const text = this.pending.slice(0, end);
      this.pending = this.pending.slice(end);
      return { text, done: true };
    }
    const before = this.pending.slice(0, at);
    const text = before.trimEnd();
    const rest = this.pending.slice(at);
    const repeated = Object.values(intents).find(marker => rest.startsWith(marker));
    if (repeated) {
      if (this.intent && repeated !== intents[this.intent]) this.note('DeepSeek 返回了相互矛盾的资料意图，个人信息未修改。');
      this.pending = rest.slice(repeated.length);
      return { text, done: false };
    }
    if (rest.startsWith(proposalOpen)) {
      if (this.intent === 'proposal' && this.payload === undefined) this.payload = '';
      else {
        this.skipping = true;
        this.note(this.intent === 'proposal' ? 'DeepSeek 返回了多个资料提案，个人信息未修改。'
          : this.intent === 'none' ? 'DeepSeek 标明不修改资料却返回了提案，个人信息未修改。' : missingIntent);
      }
      this.phase = 'proposal';
      this.pending = rest.slice(proposalOpen.length);
      return { text, done: false };
    }
    if (rest.startsWith(proposalClose)) {
      this.note('DeepSeek 返回的资料提案格式无效，个人信息未修改。');
      this.pending = rest.slice(proposalClose.length);
      return { text, done: false };
    }
    if ([...Object.values(intents), proposalOpen, proposalClose].some(marker => marker.startsWith(rest))) {
      this.pending = before.slice(text.length) + rest;
      return { text, done: true };
    }
    // Not a protocol marker: keep it as ordinary answer text.
    this.pending = rest.slice(1);
    return { text: before + rest[0], done: false };
  }

  private readProposal() {
    this.block += this.pending;
    this.pending = '';
    const end = this.block.indexOf(proposalClose);
    if (!this.skipping) this.payload = end < 0 ? this.block : this.block.slice(0, end);
    if (end < 0) return false;
    this.pending = this.block.slice(end + proposalClose.length);
    this.block = '';
    this.skipping = false;
    this.phase = 'answer';
    return true;
  }

  preview(): ProfilePreview | undefined {
    this.generation = undefined;
    if (!this.previewReady) return;
    const result = streamedProfilePreview(proposalJson(this.payload!), ['changes']);
    this.generation = result?.generation;
    return result?.preview;
  }

  finish(base: PersonalInfo): DeepSeekProfileResult {
    // A held partial marker at the very end is ordinary answer text; held whitespace is dropped.
    const answerText = this.structureOnly ? '' : (this.visible + (this.phase === 'answer' ? this.pending : '')).trim();
    const delta = answerText.slice(this.visible.length);
    const unresolved = (issue: string) => ({ answerText, delta, changes: {}, skillScope: null, issue });
    if (!this.structureOnly && !answerText && (this.intent !== 'proposal' || this.payload === undefined))
      throw new ProfileOutputError('DeepSeek 返回了空白回答，请重试。');
    if (this.issue || !this.intent) return unresolved(this.issue ?? missingIntent);
    if (this.intent === 'none') return { answerText, delta, changes: {}, skillScope: null };
    if (this.payload === undefined)
      return unresolved('DeepSeek 标明要修改资料，但没有返回提案内容，个人信息未修改。');
    let value: Record<string, unknown> | undefined;
    try {
      value = record(JSON.parse(proposalJson(this.payload).replace(fenceClosing, '')));
    } catch {
      value = undefined;
    }
    if (!value || !record(value.changes) || Object.keys(value).some(key => key !== 'changes' && key !== 'skillScope'))
      return unresolved('资料更新提案不完整，未修改个人信息，请重试。');
    try {
      const { changes, skillScope } = resolveProposal(base, value);
      if (!Object.keys(changes).length) return unresolved('DeepSeek 的资料提案与当前资料相同，没有可保存的修改。');
      return { answerText, delta, changes, skillScope };
    } catch (error) {
      return unresolved(error instanceof Error ? error.message : '资料更新格式无效，未修改个人信息。');
    }
  }
}

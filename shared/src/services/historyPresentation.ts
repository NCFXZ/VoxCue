import type { Answer, Transcript } from './contracts';
import type { InterviewRecord } from './history';
import { t, uiLocale } from '../i18n';
const normalized = (value: string) =>
  value
    .normalize('NFKC')
    .replace(/[\p{P}\p{Z}\s]/gu, '')
    .toLowerCase();
export function visibleAnswers(record: InterviewRecord) {
  return record.answers.filter((a) => a.provider !== 'mock');
}
export function answerCountLabel(count: number) {
  return count === 1 ? t('1 条 AI 回答') : `${count}${t(' 条 AI 回答')}`;
}
export function answerSourceLookup(record: InterviewRecord) {
  const byId = new Map(record.transcripts.map(row => [row.id, row]));
  let legacyRows: { id: string; text: string }[] | undefined;
  let matches: Map<string, string[] | null> | undefined;
  return (answer: Answer): string[] => {
    if (answer.sourceTranscriptIds !== undefined) {
      const ids = answer.sourceTranscriptIds;
      if (!ids.length) return [];
      // Older onsite answers still have explicit IDs. Only infer the mic when the entire
      // question agrees with those IDs; never infer from unrelated microphone text.
      const legacyMic = !answer.questionSource && ids.every(id => byId.get(id)?.source === 'microphone') &&
        normalized(ids.map(id => byId.get(id)!.text).join('')) === normalized(answer.question);
      const source = answer.questionSource ?? (legacyMic ? 'microphone' : 'system');
      return ids.filter(id => byId.has(id) && (byId.get(id)!.source ?? 'system') === source);
    }
    const question = normalized(answer.question);
    if (!question) return [];
    legacyRows ??= record.transcripts.filter(row => row.source !== 'microphone')
      .map(row => ({ id: row.id, text: normalized(row.text) }));
    if (!matches) {
      const questions = record.answers.filter(a => a.sourceTranscriptIds === undefined)
        .map(a => normalized(a.question));
      matches = matchLegacyQuestions(legacyRows, [...questions, question]);
    } else if (!matches.has(question)) {
      // Callers can also ask about a question outside the saved record.
      matches.set(question, matchLegacyQuestions(legacyRows, [question]).get(question) ?? null);
    }
    return [...(matches.get(question) ?? [])];
  };
}
function matchLegacyQuestions(rows: { id: string; text: string }[], questions: string[]) {
  const matches = new Map<string, string[] | null>();
  let longest = 0;
  for (const question of questions) {
    if (!question) continue;
    matches.set(question, null);
    longest = Math.max(longest, question.length);
  }
  for (let i = 0; i < rows.length; i++) {
    let text = '';
    for (let j = i; j < Math.min(i + 6, rows.length); j++) {
      if (!rows[j].text) continue;
      text += rows[j].text;
      const previous = matches.get(text);
      if (previous === null) matches.set(text, rows.slice(i, j + 1).map(row => row.id));
      else if (previous?.length) matches.set(text, []);
      if (text.length >= longest) break;
    }
  }
  return matches;
}
export function relativeTime(record: InterviewRecord, row: Transcript): string {
  if (!Number.isFinite(row.startMs)) return row.time || '—';
  const seconds = Math.floor(Math.max(0, row.startMs! - record.startedAt) / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
export function duration(record: InterviewRecord) {
  const seconds = Math.floor(Math.max(0, record.endedAt - record.startedAt) / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
export function titleQuestions(record: InterviewRecord): string[] {
  const questions = [
    ...record.transcripts
      .filter((t) => t.source === 'system' && t.reason !== 'discontinuity' && t.text.trim())
      .map((t) => t.text),
    ...visibleAnswers(record).map((a) => a.question),
  ];
  const unique = [...new Set(questions.map((q) => q.trim().slice(0, 600)).filter(Boolean))];
  if (unique.length <= 24) return unique;
  return Array.from({ length: 24 }, (_, i) => unique[Math.round((i * (unique.length - 1)) / 23)]);
}
export function exportRecord(record: InterviewRecord): string {
  const date = (time: number) => new Date(time).toLocaleString(uiLocale(), { hour12: false });
  const lines = [
    record.title,
    `${date(record.startedAt)} — ${date(record.endedAt)}`,
    `${duration(record)} · ${answerCountLabel(visibleAnswers(record).length)}`,
    '',
    t('面试转录'),
  ];
  for (const row of record.transcripts)
    lines.push(
      `[${relativeTime(record, row)}] ${t(row.source === 'microphone' ? '我' : '面试官')}${t(row.reason === 'discontinuity' ? '（音频间断，可能不完整）' : row.final ? '' : '（未完成）')}`,
      row.text,
      '',
    );
  lines.push(t('AI 回答'), '');
  for (const answer of visibleAnswers(record)) {
    lines.push(
      t('问题：{0}', [answer.question]),
      answer.content || t('这条回答没有保存内容。'),
      '',
    );
    if (answer.images?.length)
      lines.push(t('已保存截图：{0}张（原图在应用面试记录中查看）', [answer.images.length]), '');
    if (answer.reasoningSummary) lines.push(t('公开推理摘要：'), answer.reasoningSummary, '');
  }
  return lines.join('\r\n');
}

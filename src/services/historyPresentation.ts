import type { Answer, Transcript } from './contracts';
import type { InterviewRecord } from './history';
const normalized = (value: string) =>
  value
    .normalize('NFKC')
    .replace(/[\p{P}\p{Z}\s]/gu, '')
    .toLowerCase();
export function visibleAnswers(record: InterviewRecord) {
  return record.answers.filter((a) => a.provider !== 'mock');
}
export function sourceIds(record: InterviewRecord, answer: Answer): string[] {
  const rows = record.transcripts.filter((t) => t.source !== 'microphone');
  if (answer.sourceTranscriptIds?.length)
    return answer.sourceTranscriptIds.filter((id) => rows.some((t) => t.id === id));
  const question = normalized(answer.question);
  if (!question) return [];
  const matches: string[][] = [];
  for (let i = 0; i < rows.length; i++) {
    let text = '';
    const ids: string[] = [];
    for (let j = i; j < Math.min(i + 6, rows.length); j++) {
      text += normalized(rows[j].text);
      ids.push(rows[j].id);
      if (text === question) {
        matches.push([...ids]);
        break;
      }
      if (text.length >= question.length) break;
    }
  }
  return matches.length === 1 ? matches[0] : [];
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
    ...record.transcripts.filter((t) => t.source === 'system' && t.text.trim()).map((t) => t.text),
    ...visibleAnswers(record).map((a) => a.question),
  ];
  const unique = [...new Set(questions.map((q) => q.trim().slice(0, 600)).filter(Boolean))];
  if (unique.length <= 24) return unique;
  return Array.from({ length: 24 }, (_, i) => unique[Math.round((i * (unique.length - 1)) / 23)]);
}
export function exportRecord(record: InterviewRecord): string {
  const date = (time: number) => new Date(time).toLocaleString('zh-CN', { hour12: false });
  const lines = [
    record.title,
    `${date(record.startedAt)} — ${date(record.endedAt)}`,
    `${duration(record)} · ${visibleAnswers(record).length} 条 AI 回答`,
    '',
    '面试转录',
  ];
  for (const row of record.transcripts)
    lines.push(
      `[${relativeTime(record, row)}] ${row.source === 'microphone' ? '我' : '面试官'}${row.final ? '' : '（未完成）'}`,
      row.text,
      '',
    );
  lines.push('AI 回答', '');
  for (const answer of visibleAnswers(record)) {
    lines.push(`问题：${answer.question}`, answer.content || '这条回答没有保存内容。', '');
    if (answer.reasoningSummary) lines.push('公开推理摘要：', answer.reasoningSummary, '');
  }
  return lines.join('\r\n');
}

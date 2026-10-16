export const answerStyles = [
  { id: 'concise', label: '简洁直接', description: '先给结论，突出关键要点。' },
  { id: 'balanced', label: '条理清晰', description: '结论、理由与必要示例。' },
  { id: 'detailed', label: '详细展开', description: '分步说明，补充案例与细节。' },
] as const;
export interface AnswerStyle {
  preset: (typeof answerStyles)[number]['id'];
  custom: string;
}
export const defaultAnswerStyle: AnswerStyle = { preset: 'balanced', custom: '' };
export function validateAnswerStyle(value: unknown): AnswerStyle {
  const style = value as AnswerStyle;
  if (
    !style ||
    !answerStyles.some((item) => item.id === style.preset) ||
    typeof style.custom !== 'string' ||
    style.custom.length > 1200
  )
    throw new Error('回答风格格式无效，补充要求最多 1200 字。');
  return { preset: style.preset, custom: style.custom.trim() };
}
export function answerStyleInstructions(value: AnswerStyle) {
  const style = validateAnswerStyle(value);
  const instructions = {
    concise:
      '回答风格：简洁直接。先给结论，用简短段落或要点回答，省略重复铺垫；保留必要条件和不确定性说明。',
    balanced: '回答风格：条理清晰。先给结论，再解释关键理由，必要时补充一个例子；避免冗长和重复。',
    detailed:
      '回答风格：详细展开。分步解释思路、依据和适用条件，按需补充具体例子、权衡与注意事项；避免无关扩展。',
  };
  return (
    '\n' +
    instructions[style.preset] +
    (style.custom ? `\n用户补充的表达偏好：${style.custom}` : '')
  );
}

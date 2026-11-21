// The same public synthetic answer exercises each renderer and available copy action.
export const opening = Array.from({ length: 90 }, (_, i) =>
  `Stage ${i + 1}: compare **two receipts**, then record the unique delivery code.`).join('\n\n');
export const ending = '\n\n| Topic | Result |\n| --- | --- |\n| Closing check | **All receipts reconciled** |';
export const longMarkdown = opening + ending;

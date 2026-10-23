// Geometry is shared; each renderer decides how to paint the covered header.
export function headerCoverage(column: Element, header: DOMRect): number {
  let overlap = 0;
  for (const content of column.querySelectorAll(
    '.chat-message, .management-container > *, .knowledge-grid > *, .history-timeline > *, .record-reading-column > *, .record-answer-scroll > *',
  )) {
    const bounds = content.getBoundingClientRect();
    if (
      bounds.bottom > header.top &&
      bounds.top < header.bottom &&
      bounds.right > header.left &&
      bounds.left < header.right
    )
      overlap = Math.max(overlap, header.bottom - bounds.top);
  }
  return Math.min(1, Math.max(0, overlap / 24));
}

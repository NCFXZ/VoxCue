// Only the panel boxes grow. Fonts, controls, spacing and the notice area keep
// their normal size, so a larger window exposes more text instead of zooming it.
export const interviewLayout = {
  transcriptWidth: 420,
  answerWidth: 600,
  panelHeight: 500,
  gap: 16,
  padding: 12,
  chromeHeight: 164,
  minimumScale: 0.75,
  collapsedWidth: 420,
  collapsedHeight: 72,
} as const;

export function interviewPanelWidth(transcriptVisible = true) {
  return interviewLayout.answerWidth + (transcriptVisible ? interviewLayout.transcriptWidth : 0);
}

export function interviewPanelScale(width: number, transcriptVisible = true) {
  const fixedWidth = interviewLayout.padding * 2 + (transcriptVisible ? interviewLayout.gap : 0);
  return Math.max(0, (width - fixedWidth) / interviewPanelWidth(transcriptVisible));
}

export function interviewCanvas(transcriptVisible = true, collapsed = false, scale = 1) {
  return collapsed
    ? {
        width: interviewLayout.collapsedWidth,
        height: interviewLayout.collapsedHeight,
      }
    : {
        width:
          interviewLayout.padding * 2 +
          interviewPanelWidth(transcriptVisible) * scale +
          (transcriptVisible ? interviewLayout.gap : 0),
        height: interviewLayout.chromeHeight + interviewLayout.panelHeight * scale,
      };
}

interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}
export function fitInterviewBounds(
  anchor: Bounds,
  area: Bounds,
  desiredScale: number,
  transcriptVisible = true,
  collapsed = false,
) {
  const fixed = interviewCanvas(transcriptVisible, false, 0);
  const originalCenter = anchor.x + anchor.width / 2;
  const center =
    originalCenter > area.x && originalCenter < area.x + area.width
      ? originalCenter
      : area.x + area.width / 2;
  // Grow around the toolbar, stopping at the nearest display edge. A larger
  // request must never push the toolbar sideways or upwards to make room.
  const availableWidth = 2 * Math.min(center - area.x, area.x + area.width - center);
  const top = Math.max(
    area.y,
    Math.min(
      anchor.y,
      area.y +
        area.height -
        (collapsed ? interviewCanvas(transcriptVisible, true, 1).height : fixed.height),
    ),
  );
  const maximum = Math.max(
    0,
    Math.min(
      (availableWidth - fixed.width) / interviewPanelWidth(transcriptVisible),
      (area.y + area.height - top - fixed.height) / interviewLayout.panelHeight,
    ),
  );
  const scale = Math.max(
    Math.min(interviewLayout.minimumScale, maximum),
    Math.min(desiredScale, maximum),
  );
  const canvas = interviewCanvas(transcriptVisible, collapsed, scale);
  const width = Math.min(Math.floor(availableWidth), Math.round(canvas.width)),
    height = Math.min(area.height, Math.round(canvas.height));
  // Symmetric integer deltas avoid accumulating a pixel on hide/show cycles.
  const left =
    originalCenter === center
      ? anchor.x + Math.trunc((anchor.width - width) / 2)
      : center - width / 2;
  return {
    x: Math.round(Math.max(area.x, Math.min(left, area.x + area.width - width))),
    y: Math.round(top),
    width,
    height,
  };
}

export function draggedInterviewScale(
  scale: number,
  dx: number,
  dy: number,
  edge: 'left' | 'right',
  transcriptVisible: boolean,
) {
  const width = interviewPanelWidth(transcriptVisible) / 2;
  const height = interviewLayout.panelHeight;
  const horizontal = dx * (edge === 'right' ? 1 : -1);
  return scale + (horizontal * width + dy * height) / (width ** 2 + height ** 2);
}

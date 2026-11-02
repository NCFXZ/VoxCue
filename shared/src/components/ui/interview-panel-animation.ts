// Shared by the real window and the gesture-controlled settings preview.
export const interviewPanelAnimation = {
  open: { opacity: 1, transform: 'translateY(0)' },
  fold: { opacity: 0, transform: 'translateY(-14px)' },
  collapseDuration: 220,
  expandDuration: 280,
  easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
} as const;

// Both native layout changes and the fixed preview use this same visual sequence.
export async function playInterviewTranscript(
  frame: HTMLElement | null | undefined,
  showing: boolean,
  play: (node: Element | null, frames: Keyframe[], duration: number) => Promise<void>,
) {
  const answer = frame?.querySelector<HTMLElement>('.floating-answer');
  if (!frame || !answer) return;
  const panelBounds = answer.getBoundingClientRect();
  const frameBounds = frame.getBoundingClientRect();
  const offset = frameBounds.x + frameBounds.width / 2 - panelBounds.x - panelBounds.width / 2;
  const hidden = { opacity: 0, transform: 'translateX(-18px)' };
  const visible = { opacity: 1, transform: 'translateX(0)' };
  const centered = { transform: `translateX(${offset}px)` };
  const positioned = { transform: 'translateX(0)' };
  await Promise.all([
    play(
      frame.querySelector('.floating-transcript'),
      showing ? [hidden, visible] : [visible, hidden],
      showing ? 240 : 200,
    ),
    play(answer, showing ? [centered, positioned] : [positioned, centered], 240),
  ]);
}

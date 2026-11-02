import { interviewPanelAnimation, playInterviewTranscript } from './interview-panel-animation';

export function installPreviewTranscript(frame: HTMLElement, button: HTMLButtonElement) {
  const transcript = frame.querySelector<HTMLElement>('.floating-transcript')!;
  const preference = matchMedia('(prefers-reduced-motion: reduce)');
  const players = new Set<Animation>();
  let moving = false;
  let disposed = false;
  const clear = () => {
    for (const player of players) player.cancel();
    players.clear();
  };
  const setVisible = (visible: boolean) => {
    transcript.hidden = !visible;
    frame.classList.toggle('answer-only', !visible);
    button.setAttribute('aria-pressed', String(visible));
  };
  const play = (node: Element | null, frames: Keyframe[], duration: number) => {
    if (!node || disposed || preference.matches) return Promise.resolve();
    const player = node.animate(frames, {
      duration,
      easing: interviewPanelAnimation.easing,
      fill: 'both',
    });
    players.add(player);
    return player.finished.then(
      () => undefined,
      () => undefined,
    );
  };
  const toggle = async () => {
    if (moving || disposed || frame.inert || document.hidden) return;
    moving = true;
    button.setAttribute('aria-disabled', 'true');
    const showing = transcript.hidden;
    try {
      // As in the native window, grow the layout before entering and remove
      // the transcript only after both outgoing animations have finished.
      if (showing) setVisible(true);
      await playInterviewTranscript(frame, showing, play);
      if (!disposed && !showing) setVisible(false);
    } finally {
      clear();
      moving = false;
      if (!disposed) button.setAttribute('aria-disabled', 'false');
    }
  };
  const motion = () => {
    if (preference.matches) clear();
  };
  const visibility = () => {
    if (document.hidden) clear();
  };
  button.addEventListener('click', toggle);
  preference.addEventListener('change', motion);
  document.addEventListener('visibilitychange', visibility);
  return () => {
    disposed = true;
    clear();
    setVisible(true);
    button.removeEventListener('click', toggle);
    preference.removeEventListener('change', motion);
    document.removeEventListener('visibilitychange', visibility);
  };
}

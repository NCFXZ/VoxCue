/** Play the page entrance once on the newly sent message group. */
export function playSentMessageEnter(group: HTMLElement | null | undefined) {
  if (!group?.getClientRects().length) return;
  group.classList.add('sent-message-enter');
  const clear = () => group.classList.remove('sent-message-enter');
  const entrance = group.getAnimations().find(
    animation => animation instanceof CSSAnimation && animation.animationName === 'screen-enter',
  );
  if (entrance) void entrance.finished.then(clear, clear);
  else clear();
}

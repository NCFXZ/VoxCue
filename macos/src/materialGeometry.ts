// Native artwork replaces the element's own paint, but keeps ancestor fades.
export function materialOpacity(element: Element) {
  let opacity = 1;
  for (let parent = element.parentElement; parent; parent = parent.parentElement)
    opacity *= Number(getComputedStyle(parent).opacity);
  return Math.min(1, Math.max(0, opacity));
}

// Resolve only opaque presentation colors; IPC accepts canonical RGB hex.
export function materialColor(element: Element, property: string) {
  const value = getComputedStyle(element).getPropertyValue(property).trim();
  if (/^#[a-f0-9]{6}$/i.test(value)) return value;
  if (/^#[a-f0-9]{3}$/i.test(value))
    return '#' + [...value.slice(1)].map((digit) => digit + digit).join('');
  const channels = value.match(/^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/);
  if (channels)
    return (
      '#' +
      channels
        .slice(1)
        .map((channel) => Number(channel).toString(16).padStart(2, '0'))
        .join('')
    );
  throw Error('Unsupported material color');
}

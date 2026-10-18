import { useEffect, useState } from 'react';

const storageKey = 'voxcue-interview-font-size-v1';
const changedEvent = 'voxcue-interview-font-size-changed';
export const interviewFontSize = { minimum: 12, maximum: 24, default: 14 } as const;
const valid = (value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isInteger(value) &&
  value >= interviewFontSize.minimum &&
  value <= interviewFontSize.maximum;

export function readInterviewFontSize(): number {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(storageKey) ?? 'null');
    return valid(saved) ? saved : interviewFontSize.default;
  } catch {
    return interviewFontSize.default;
  }
}

export function saveInterviewFontSize(value: number) {
  if (!valid(value)) throw Error('无效的面试字号。');
  localStorage.setItem(storageKey, JSON.stringify(value));
  window.dispatchEvent(new Event(changedEvent));
}

export function subscribeInterviewFontSize(callback: (value: number) => void) {
  const update = () => callback(readInterviewFontSize());
  const stored = (event: StorageEvent) => {
    if (!event.key || event.key === storageKey) update();
  };
  window.addEventListener('storage', stored);
  window.addEventListener(changedEvent, update);
  return () => {
    window.removeEventListener('storage', stored);
    window.removeEventListener(changedEvent, update);
  };
}

export function useInterviewFontSize() {
  const [size, setSize] = useState(readInterviewFontSize);
  useEffect(() => {
    const unsubscribe = subscribeInterviewFontSize(setSize);
    setSize(readInterviewFontSize());
    return unsubscribe;
  }, []);
  return size;
}

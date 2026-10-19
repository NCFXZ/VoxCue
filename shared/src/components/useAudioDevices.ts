import { useEffect, useState } from 'react';
import { initialAudioDevices, subscribeAudioDevices } from '../services/audioDevices';
export function useAudioDevices() {
  const [state, setState] = useState(initialAudioDevices);
  useEffect(() => subscribeAudioDevices(setState), []);
  return state;
}

import { useEffect, useState } from 'react';
import type { SpeechHardware } from '../../electron/contracts/speech';

export function useSpeechHardware() {
  const [hardware, setHardware] = useState<SpeechHardware>();
  useEffect(() => {
    let disposed = false;
    void (
      window.desktop?.speechHardware?.() ??
      Promise.resolve<SpeechHardware>({
        cuda: false,
        reason: window.desktop?.platform === 'macos' ? 'platform' : 'unavailable',
      })
    )
      .catch((): SpeechHardware => ({ cuda: false, reason: 'unavailable' }))
      .then((value) => {
        if (!disposed) setHardware(value);
      });
    return () => {
      disposed = true;
    };
  }, []);
  return hardware;
}

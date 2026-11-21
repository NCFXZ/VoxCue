// Large legacy records use the original JSON wire format. Parse away from the UI thread.
self.onmessage = async ({ data }: MessageEvent<Blob>) => {
  try {
    self.postMessage({ ok: true, value: JSON.parse(await data.text()) });
  } catch {
    self.postMessage({ ok: false });
  }
};

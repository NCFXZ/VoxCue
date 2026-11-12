/** Bounded fixture control stream; errors remain observable after ready resolves. */
export function audioControlReader(
  LineDecoder,
  onEvent,
  onFailure,
  diagnostics = false,
  limit = 10000,
) {
  let decoder = new LineDecoder(limit);
  let bytes = 0,
    failed = false;
  const fail = (error) => {
    failed = true;
    decoder = undefined;
    onFailure(error);
  };
  return (chunk) => {
    if (failed) return; // Drain late output without retaining it.
    bytes += chunk.length;
    if (bytes > limit) return fail(Error('Audio fixture control output exceeded its bound.'));
    for (const line of decoder.push(chunk)) {
      if (diagnostics && !line.startsWith('{')) continue;
      try {
        const value = JSON.parse(line);
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error();
        onEvent(value);
      } catch {
        return fail(Error('Malformed or rejected audio fixture control message.'));
      }
    }
  };
}

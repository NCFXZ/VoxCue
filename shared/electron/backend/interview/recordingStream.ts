import { Readable } from 'node:stream';
import { streamRecording, type LocalRecording } from './recordings';

// Chromium uses byte ranges both when probing WAV metadata and after a seek.
export function recordingResponse(request: Request, clip: LocalRecording) {
  if (!['GET', 'HEAD'].includes(request.method)) return new Response(null, { status: 405 });
  const range = request.headers.get('range');
  let start = 0,
    end = clip.size - 1;
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (match && (match[1] || match[2])) {
      start = match[1] ? Number(match[1]) : Math.max(0, clip.size - Number(match[2]));
      if (match[1] && match[2]) end = Math.min(end, Number(match[2]));
    } else start = clip.size;
    if (!Number.isSafeInteger(start) || start > end)
      return new Response(null, {
        status: 416,
        headers: { 'Content-Range': 'bytes */' + clip.size },
      });
  }
  const headers = new Headers({
    'Content-Type': 'audio/wav',
    'Accept-Ranges': 'bytes',
    'Content-Length': String(end - start + 1),
    'Cache-Control': 'no-store',
  });
  if (range) headers.set('Content-Range', 'bytes ' + start + '-' + end + '/' + clip.size);
  const stream =
    request.method === 'HEAD'
      ? null
      : (Readable.toWeb(
          streamRecording(clip, start, end, request.signal),
        ) as ReadableStream<Uint8Array>);
  return new Response(stream, { status: range ? 206 : 200, headers });
}

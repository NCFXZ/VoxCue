import { expect, it } from 'vitest';
import type { Transcript } from '../../src/services/contracts';
import { createTranscriptTimeline } from '../../src/services/transcriptTimeline';

const caption = (id: string, startMs?: number, endMs?: number): Transcript =>
  ({ id, startMs, endMs, text: id, time: '', final: true });

it('matches stable playback order at starts, exclusive ends, overlaps and reversed seeks', () => {
  const captions = [
    caption('overlap-a', 20, 37), caption('untimed'), caption('long', 0, 40),
    caption('overlap-b', 20, 37), caption('at-end', 40, 43), caption('previous', 15, 37),
    caption('point', 49, 49), caption('legacy-reversed', 65, 52), caption('later', 70, 72),
    caption('later-tie', 70, 75), caption('another-clip', 100, 120),
  ];
  const index = createTranscriptTimeline(captions);
  const ordered = captions.filter(row => row.startMs !== undefined).sort((a, b) => a.startMs! - b.startMs!);
  const times = Array.from({ length: 261 }, (_, i) => i / 2);
  for (const time of [...times, ...times.toReversed(), 100, 21, 43, 70, 16]) {
    const active = ordered.filter(row => row.startMs! <= time && time < row.endMs!);
    expect(index.at(time)).toEqual({ ids: active.map(row => row.id), current: active.at(-1) });
    if (active.length) continue;
    for (const [start, end] of [[0, 130], [43, 65], [49, 70], [75, 100], [90, 90]]) {
      if (time < start || time > end) continue;
      const nearest = ordered.filter(row => row.endMs! > start && row.startMs! < end)
        .sort((a, b) => Math.max(a.startMs! - time, time - a.endMs!, 0) -
          Math.max(b.startMs! - time, time - b.endMs!, 0))[0];
      expect(index.nearestInGap(time, start, end)).toBe(nearest);
    }
  }
  expect(index.at(null)).toEqual({ ids: [], current: undefined });
  expect(index.at(20).ids).toEqual(['long', 'previous', 'overlap-a', 'overlap-b']);
});

it('does not revisit old captions during a long overlapping utterance or scan a silent seek', () => {
  let reads = 0;
  const tracked = (id: string, start: number, end: number): Transcript => ({
    ...caption(id),
    get startMs() { reads++; return start; },
    get endMs() { reads++; return end; },
  });
  const rows = Array.from({ length: 8192 }, (_, i) => tracked(String(i), i * 100, i * 100 + 45));
  const index = createTranscriptTimeline([tracked('long', 0, 410000), ...rows]);
  const active = index.at(400001);
  expect(active.ids).toEqual(['long', '4000']);
  reads = 0;
  for (let time = 400002; time < 400045; time++) expect(index.at(time)).toBe(active);
  expect(reads).toBe(0);
  expect(index.at(400045).ids).toEqual(['long']);
  expect(index.at(400101).ids).toEqual(['long', '4001']);
  expect(reads).toBeLessThan(100);
  reads = 0;
  expect(index.at(700080).ids).toEqual([]);
  expect(index.nearestInGap(700080, 0, 800000)?.id).toBe('7001');
  expect(reads).toBeLessThan(100);
});

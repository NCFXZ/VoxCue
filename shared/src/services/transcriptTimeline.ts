import type { Transcript } from './contracts';

type TimedTranscript = Transcript & { startMs: number; endMs: number };

// Find the first row past a boundary in an index ordered by that boundary.
function firstAfter(rows: TimedTranscript[], past: (row: TimedTranscript) => boolean) {
  let low = 0, high = rows.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (past(rows[middle])) high = middle;
    else low = middle + 1;
  }
  return low;
}

export function createTranscriptTimeline(transcripts: Transcript[]) {
  const rows = transcripts.filter((row): row is TimedTranscript =>
    row.startMs !== undefined && row.endMs !== undefined
  ).sort((a, b) => a.startMs - b.startMs);
  // Each prefix remembers its latest ending caption, keeping the first one on ties.
  const latestEnd: TimedTranscript[] = [];
  for (const row of rows) {
    const prior = latestEnd.at(-1);
    latestEnd.push(prior && prior.endMs >= row.endMs ? prior : row);
  }
  const silence = { ids: [] as string[], current: undefined as TimedTranscript | undefined };
  let position = silence;
  let active: TimedTranscript[] = [];
  let from = Infinity, until = -Infinity, cursor = 0;
  return {
    rows,
    at(time: number | null) {
      if (time === null) return silence;
      if (from <= time && time < until) return position;

      const next = firstAfter(rows, row => row.startMs > time);
      let first = firstAfter(latestEnd, row => row.endMs > time);
      if (time >= from) {
        active = active.filter(row => row.endMs > time);
        first = Math.max(first, cursor);
      } else active = [];
      for (let i = first; i < next; i++) {
        if (rows[i].endMs > time) active.push(rows[i]);
      }
      from = time;
      cursor = next;
      until = rows[next]?.startMs ?? Infinity;
      for (const row of active) until = Math.min(until, row.endMs);
      position = active.length ? { ids: active.map(row => row.id), current: active.at(-1) } : silence;
      return position;
    },
    nearestInGap(time: number, clipStart: number, clipEnd: number) {
      const next = firstAfter(rows, row => row.startMs > time || row.startMs >= clipEnd);
      const prior = latestEnd[next - 1];
      let closest = prior && prior.endMs > clipStart ? prior : undefined;
      let distance = closest ? time - closest.endMs : Infinity;
      // The next start normally settles the choice. Old reversed intervals can
      // require another candidate, but later starts cannot beat this distance.
      for (let i = next; i < rows.length; i++) {
        const row = rows[i];
        if (row.startMs >= clipEnd || row.startMs - time >= distance) break;
        if (row.endMs <= clipStart) continue;
        const gap = Math.max(row.startMs - time, time - row.endMs);
        if (gap < distance) {
          closest = row;
          distance = gap;
        }
      }
      return closest;
    },
  };
}

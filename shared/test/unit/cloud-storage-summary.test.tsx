import { beforeEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CloudStorageSummary } from '../../src/components/CloudStorageSummary';
import type { CloudStorage } from '../../electron/contracts/cloudSync';

const fixture = vi.hoisted(() => ({ storage: undefined as CloudStorage | undefined }));
vi.mock('../../src/stores/cloudSync', () => ({
  useCloudSync: (selector: (state: typeof fixture) => unknown) => selector(fixture),
}));
beforeEach(() => {
  fixture.storage = undefined;
});
function setStorage(profile: number, history: number, knowledgebase: number) {
  fixture.storage = {
    capacityBytes: 100000000,
    knowledgeCapacityBytes: 100000000,
    currentBytes: { profile, history, knowledgebase },
    storedBytes: { profile, history, knowledgebase },
    reservedBytes: { profile: 0, history: 0, knowledgebase: 0 },
  };
}
const view = () => {
  const html = renderToStaticMarkup(<CloudStorageSummary />);
  return {
    html,
    widths: [...html.matchAll(/style="width:([\d.]+)%"/g)].map((match) => Number(match[1])),
  };
};
it('fits all three metered categories at 101 MB without hiding profile excess', () => {
  setStorage(1000000, 40000000, 60000000);
  const { html, widths } = view();
  expect(widths).toHaveLength(3);
  expect(widths.reduce((sum, value) => sum + value, 0)).toBeCloseTo(100, 10);
  for (const [index, value] of [1, 40, 60].entries())
    expect(widths[index]).toBeCloseTo((value / 101) * 100, 10);
  expect(html).toContain('已用 101000000 字节，总容量 100000000 字节');
  expect(html).toContain('可用 0.00 MB · 已用 101.00 MB');
  expect(html).not.toContain(' title=');
});
it('retains capacity-based widths below the limit', () => {
  setStorage(1000000, 2000000, 3000000);
  expect(view().widths).toEqual([1, 2, 3]);
});
it('does not invent a capacity or used balance before metadata arrives', () => {
  const { html, widths } = view();
  expect(widths).toEqual([0, 0, 0]);
  expect(html).toContain('容量尚未读取');
  expect(html).not.toContain('已用 0.00 MB');
});

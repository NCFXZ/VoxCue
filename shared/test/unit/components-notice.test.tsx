import { afterEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ComponentState } from '../../electron/contracts/components';
const current = vi.hoisted(() => ({ state: null as ComponentState | null }));
vi.mock('../../src/stores/components', () => ({ useComponents: (select: any) => select(current) }));
import { ComponentsNotice } from '../../src/components/ComponentsNotice';
afterEach(() => vi.unstubAllGlobals());
function state(speech: boolean, qwen: boolean, rag = true): ComponentState {
  vi.stubGlobal('window', { desktop: { components() {} } });
  return {
    revision: 1,
    phase: 'needed',
    error: null,
    items: [
      {
        id: 'speech',
        label: '本地语音模型',
        bytes: 1,
        received: 0,
        phase: speech ? 'ready' : 'pending',
      },
      {
        id: 'qwen',
        label: 'Qwen',
        bytes: 1,
        received: 0,
        optional: true,
        phase: qwen ? 'ready' : 'pending',
      },
      { id: 'rag', label: '知识库模型', bytes: 1, received: 0, phase: rag ? 'ready' : 'pending' },
    ],
  };
}
it.each([
  [true, false],
  [false, true],
  [true, true],
])('任意语音模型就绪(%s/%s)不显示缺模型提示', (speech, qwen) => {
  current.state = state(speech, qwen);
  expect(renderToStaticMarkup(<ComponentsNotice />)).toBe('');
});
it('都未下载时显示缺失语音模型，Qwen/CPU已就绪时只显示性能提示', () => {
  current.state = state(false, false);
  expect(renderToStaticMarkup(<ComponentsNotice />)).toContain('轻量语音识别');
  current.state = state(false, true);
  const html = renderToStaticMarkup(
    <ComponentsNotice
      speechOptions={{ sources: ['system'], speechModel: 'qwen', inferenceDevice: 'cpu' }}
    />,
  );
  expect(html).toContain('语音推理性能提示');
  expect(html).toContain('明显延迟');
  expect(html).not.toContain('尚未就绪');
});
it('Paraformer/CPU与Qwen/Metal不显示CPU性能提示，知识库缺失单独保留', () => {
  current.state = state(true, true);
  for (const options of [
    {
      sources: ['system'] as ['system'],
      speechModel: 'paraformer' as const,
      inferenceDevice: 'cpu' as const,
    },
    {
      sources: ['system'] as ['system'],
      speechModel: 'qwen' as const,
      inferenceDevice: 'metal' as const,
    },
  ])
    expect(renderToStaticMarkup(<ComponentsNotice speechOptions={options} />)).toBe('');
  current.state = state(false, true, false);
  const html = renderToStaticMarkup(<ComponentsNotice />);
  expect(html).toContain('知识库检索');
  expect(html).not.toContain('轻量语音识别');
});

import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ComponentState } from '../../electron/contracts/components';
import { useGeneralSettings } from '../../src/stores/generalSettings';
beforeEach(() => useGeneralSettings.setState({ language: 'zh-CN' }));
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
it('缺失组件副标题包含组件名和下载入口，中英文标点正确', () => {
  current.state = state(false, false, false);
  current.state.items[1].optional = false;
  expect(renderToStaticMarkup(<ComponentsNotice />)).toContain(
    '语音识别、知识库检索组件未下载，请在设置中下载或查看进度',
  );
  for (const only of ['speech', 'qwen'] as const) {
    const html = renderToStaticMarkup(<ComponentsNotice only={only} />);
    expect(html).toContain('语音识别尚未就绪');
    expect(html).toContain('语音识别组件未下载，请在设置中下载或查看进度');
    expect(html).not.toContain('轻量语音识别');
    expect(html).not.toContain('多语言语音识别');
  }
  useGeneralSettings.setState({ language: 'en' });
  expect(renderToStaticMarkup(<ComponentsNotice />)).toContain(
    'Not downloaded: Speech recognition, Knowledge retrieval. Download components or check progress in Settings.',
  );
  for (const only of ['speech', 'qwen'] as const) {
    const html = renderToStaticMarkup(<ComponentsNotice only={only} />);
    expect(html).toContain('Speech recognition is not ready');
    expect(html).toContain(
      'Not downloaded: Speech recognition. Download components or check progress in Settings.',
    );
    expect(html).not.toContain('Lightweight speech recognition');
    expect(html).not.toContain('Multilingual speech recognition');
  }
});
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
  expect(renderToStaticMarkup(<ComponentsNotice />)).toContain('语音识别组件未下载');
  current.state = state(false, true);
  const html = renderToStaticMarkup(
    <ComponentsNotice
      speechOptions={{ sources: ['system'], speechModel: 'qwen', inferenceDevice: 'cpu' }}
    />,
  );
  expect(html).toContain('语音推理性能提示');
  expect(html).toContain('多语言语音识别性能受限');
  expect(html).toContain('明显延迟');
  expect(html).not.toContain('尚未就绪');
  expect(html).not.toContain('组件未下载');
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
  expect(html).not.toContain('语音识别');
  expect(renderToStaticMarkup(<ComponentsNotice only="rag" />)).toContain(
    '知识库检索组件未下载，请在设置中下载或查看进度',
  );
  useGeneralSettings.setState({ language: 'en' });
  expect(renderToStaticMarkup(<ComponentsNotice only="rag" />)).toContain(
    'Not downloaded: Knowledge retrieval. Download components or check progress in Settings.',
  );
});

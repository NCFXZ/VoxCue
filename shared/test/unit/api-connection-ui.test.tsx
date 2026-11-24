import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { apiProviderIds, apiProviders } from '../../electron/contracts/apiConnections';
import type { ChatModel } from '../../electron/contracts/chat';
import { ApiConnectionPanel, ApiProviderSettings, ApiUsageValues } from '../../src/components/ApiConnectionPanel';
import { ApiKeyDialog } from '../../src/components/ApiKeyDialog';
import { ProviderIdentity } from '../../src/components/ProviderIdentity';
import { ModelReasoningControl } from '../../src/components/ReasoningEffortControl';
import { t } from '../../src/i18n';
import {
  resolveServiceModel,
  startServiceModelSwitch,
  serviceModelPreferenceKey,
} from '../../src/services/serviceModelPreferences';
import { useGeneralSettings } from '../../src/stores/generalSettings';

beforeEach(() => {
  useGeneralSettings.setState({ language: 'zh-CN' });
  vi.stubGlobal('window', { desktop: { platform: 'windows' } });
});
afterEach(() => vi.unstubAllGlobals());

it('lists every API provider with two row actions before local credential status is available', () => {
  const html = renderToStaticMarkup(<ApiConnectionPanel />);
  const rows = [
    ...html.matchAll(/<div class="settings-entry ai-service-row"[^>]*>([\s\S]*?)<\/div><\/div>/g),
  ];
  expect(rows).toHaveLength(apiProviderIds.length);
  for (const [index, row] of rows.entries()) {
    expect(row[0]).toContain(t(apiProviders[apiProviderIds[index]].name));
    expect(row[0]).toContain('class="service-brand-icon"');
    const actions = row[1].split('<div class="ai-service-actions">')[1];
    expect(actions.match(/<button\b/g)).toHaveLength(2);
    expect(actions).toContain('启用');
    expect(actions).toContain('添加密钥');
  }
  expect(html).not.toContain('type="password"');
  expect(html).not.toContain('输入 API 密钥');
  expect(html).not.toContain('•••• ••••');
});

it('uses the settings logo for recorded answers from supported API providers', () => {
  const image = (html: string) => html.match(/<img\b[^>]*\bsrc="([^"]+)"/)?.[1];
  const marks = apiProviderIds.map(id => {
    const { name, recipient } = apiProviders[id];
    const row = renderToStaticMarkup(
      <ApiProviderSettings provider={id} known expanded={false} onExpand={vi.fn()} onChange={vi.fn()} />,
    );
    const expected = image(row);
    expect(expected).toBeTruthy();
    for (const provider of [id, { id, name, dataRecipient: recipient, modelVendor: 'Other' }]) {
      const answer = renderToStaticMarkup(<ProviderIdentity provider={provider} />);
      expect(image(answer)).toBe(expected);
      expect(answer).toContain(t(name));
    }
    return expected;
  });
  expect(new Set(marks).size).toBe(apiProviderIds.length);
  expect(image(renderToStaticMarkup(<ProviderIdentity provider="unknown" />))).toBeUndefined();
});

it.each([
  ['anthropic', 'Claude API', 'Anthropic'],
  ['gemini', 'Gemini API', 'Google'],
  ['qwen', '通义千问', '千问AI平台'],
  ['kimi', 'Kimi', 'Moonshot AI'],
  ['glm', '智谱 GLM', '智谱 AI'],
  ['doubao', '豆包', '火山方舟'],
])('shows a retired %s answer as an unknown model with no connection controls', (id, name, dataRecipient) => {
  for (const provider of [id, Object.freeze({ id, name, dataRecipient })]) {
    const html = renderToStaticMarkup(<ProviderIdentity provider={provider} />);
    expect(html).toContain('<strong class="provider-name">未知模型</strong>');
    expect(html).toMatch(/<span class="provider-avatar"><svg\b[^>]*data-ui-icon/);
    expect(html).not.toContain('service-brand-icon');
    expect(html).not.toContain(name);
  }
  expect(renderToStaticMarkup(<ApiConnectionPanel />)).not.toContain(`id="api-settings-${id}"`);
});

it('labels retired answers in English while preserving the Copilot provider for hosted models', () => {
  useGeneralSettings.setState({ language: 'en' });
  expect(renderToStaticMarkup(<ProviderIdentity provider="qwen" />)).toContain('Unknown model');
  const provider = { id: 'copilot', name: 'GitHub Copilot', dataRecipient: 'GitHub Copilot', modelVendor: 'Qwen' };
  const html = renderToStaticMarkup(<ProviderIdentity provider={provider} />);
  expect(html).toContain('<strong class="provider-name">GitHub Copilot</strong>');
  expect(html).toContain('service-brand-icon');
});

it('groups the saved key, usage and links beneath the service header with a separate replace action', () => {
  const html = renderToStaticMarkup(
    <ApiProviderSettings provider="deepseek" saved={{ provider: 'deepseek' }} expanded known
      onExpand={vi.fn()} onChange={vi.fn()} />,
  );
  expect(html).toContain('<div class="api-service" role="group" aria-label="DeepSeek">');
  expect(html).toContain('aria-controls="api-settings-deepseek"');
  expect(html).toMatch(/<span class="api-key-mask"[^>]*>•••• ••••<\/span><button[^>]*>[\s\S]*?更换密钥<\/button>/);
  expect(html).toMatch(/id="api-settings-deepseek"[\s\S]*?账户余额[\s\S]*?更换密钥[\s\S]*?获取密钥[\s\S]*?官方账单/);
  expect(html).toMatch(/class="api-usage account-quota"[^>]*><header><strong>API 用量<\/strong><button[^>]+aria-label="刷新用量"[^>]*>[\s\S]*?刷新中…<\/button><\/header><dl class="api-usage-values">/);
  expect(html).toContain('<dt>账户余额</dt><dd>读取中…</dd>');
  expect(html).not.toContain('<dt>本机请求</dt>');
  expect(html).not.toContain('role="progressbar"');
  expect(html).not.toMatch(/<input\b/);
});

it('shows the three local counters individually and adds a fourth metric only for a reported balance', () => {
  const local = { requests: 0, inputTokens: 15_200, outputTokens: 0, totalTokens: 15_200, updatedAt: null };
  for (const balance of [undefined, '0.00 CNY']) {
    const html = renderToStaticMarkup(<ApiUsageValues balance={balance} local={local} />);
    const metrics = Array.from(html.matchAll(/<dt>(.*?)<\/dt><dd>(.*?)<\/dd>/g), ([, label, value]) => [label, value]);
    expect(metrics).toEqual([
      ...(balance ? [['账户余额', balance]] : []),
      ['本机请求', '0'], ['输入 token', '15,200'], ['输出 token', '0'],
    ]);
  }
  for (const state of ['读取中…', '暂不可用']) {
    const html = renderToStaticMarkup(<ApiUsageValues local={state} />);
    expect(html.match(new RegExp('<dd>' + state + '</dd>', 'g'))).toHaveLength(3);
    expect(html).not.toContain('<dd>0</dd>');
  }
});

it.each([
  [false, '添加 API 密钥'],
  [true, '更换 API 密钥'],
] as const)('opens an empty protected field for adding or replacing a key (replace=%s)', (replacing, title) => {
  const html = renderToStaticMarkup(
    <ApiKeyDialog config={{ provider: 'openai' }} replacing={replacing} onFinish={vi.fn()} />,
  );
  expect(html).toContain(`aria-label="${title}"`);
  expect(html).not.toContain('dialog-subtitle');
  const fieldLabel = html.match(/class="api-key-label" id="([^"]+)">OpenAI API 密钥<\/div>/);
  expect(fieldLabel).toBeTruthy();
  expect(html).toContain(`aria-labelledby="${fieldLabel![1]}"`);
  expect(html).toMatch(/data-api-key-field=""[^>]*><\/div>/);
  expect(html).not.toContain('placeholder');
  const buttons = html.match(/<button\b[^>]*>[\s\S]*?<\/button>/g) ?? [];
  const eye = buttons.find((button) => button.includes('aria-label="显示密钥"'));
  expect(eye).toContain('aria-pressed="false"');
  expect(eye).toContain('<svg');
  expect(eye?.replace(/<[^>]*>/g, '').trim()).toBe('');
  expect(html).not.toContain('•••• ••••');
  for (const label of ['验证并保存', '取消']) {
    expect(buttons.find((button) => button.includes(label))).toContain('data-ui-icon');
  }
  expect(html).not.toMatch(/<(?:input|textarea)\b|contenteditable=/i);
});

it.each([
  ['openai', 'OpenAI API key'], ['deepseek', 'DeepSeek API key'],
] as const)('labels the English secure field with the service name for %s', (provider, label) => {
  useGeneralSettings.setState({ language: 'en' });
  const html = renderToStaticMarkup(<ApiKeyDialog config={{ provider }} onFinish={vi.fn()} />);
  expect(html).toContain(`>${label}</div>`);
});

it('keeps API and subscription choices separate even when the model ID is shared', () => {
  const model: ChatModel = {
    id: 'shared-model',
    label: 'Model',
    description: '',
    reasoningEfforts: ['low', 'high'],
  };
  const key = serviceModelPreferenceKey('chat');
  const values = new Map([
    [
      key,
      JSON.stringify({
        active: 'openai',
        openai: { modelId: model.id, effort: 'low' },
        chatgpt: { modelId: model.id, effort: 'high' },
      }),
    ],
  ]);
  vi.stubGlobal('localStorage', {
    getItem: (id: string) => values.get(id) ?? null,
    setItem: (id: string, value: string) => values.set(id, value),
  });
  startServiceModelSwitch('openai');
  expect(
    resolveServiceModel('chat', 'openai', [model], { modelId: model.id, effort: 'auto' })?.effort,
  ).toBe('low');
  startServiceModelSwitch('chatgpt');
  expect(
    resolveServiceModel('chat', 'chatgpt', [model], { modelId: model.id, effort: 'auto' })?.effort,
  ).toBe('high');
});

it('shows the API default without presenting it as an explicit thinking level', () => {
  const model: ChatModel = {
    id: 'reasoner',
    label: 'Reasoner',
    description: '',
    provider: { id: 'deepseek', name: 'DeepSeek', dataRecipient: 'DeepSeek' },
    reasoningEfforts: ['high', 'max'],
  };
  const props = {
    models: [model],
    modelId: model.id,
    effort: 'auto' as const,
    onEffortChange: vi.fn(),
    onModelChange: vi.fn(),
  };
  const html = renderToStaticMarkup(<ModelReasoningControl {...props} />);
  expect(html).toContain('自动');
  expect(html).not.toContain('>高<');
  const reported: ChatModel = { ...model, defaultReasoningEffort: 'high' };
  expect(renderToStaticMarkup(<ModelReasoningControl {...props} models={[reported]} />)).toContain('自动（高）');
  expect(renderToStaticMarkup(<ModelReasoningControl {...props} models={[reported]} effort="max" />))
    .not.toContain('自动（高）');
  expect(renderToStaticMarkup(<ModelReasoningControl {...props} models={[{ ...model, defaultReasoningEffort: 'low' }]} />))
    .not.toContain('自动（');
  expect(
    renderToStaticMarkup(
      <ModelReasoningControl {...props} models={[{ ...model, reasoningEfforts: [] }]} />,
    ),
  ).not.toContain('reasoning-trigger-level');
});

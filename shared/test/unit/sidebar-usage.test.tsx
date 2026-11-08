import { beforeEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AccountUsage } from '../../electron/contracts/accountUsage';
import { chatGPTAccountUsage } from '../../electron/backend/chat/quota';
import { useGeneralSettings } from '../../src/stores/generalSettings';

const connection = vi.hoisted(() => ({
  live: true,
  loadingUsage: false,
  usageLoaded: false,
  usage: null as AccountUsage | null,
  usageError: null as string | null,
  error: null,
}));
vi.mock('../../src/stores/chatConnection', () => ({ useChatConnection: () => connection }));
vi.mock('../../src/stores/preparation', () => ({
  usePreparation: () => ({ conversations: [], chatsReady: true }),
}));
vi.mock('../../src/components/SidebarUpdate', () => ({ SidebarUpdate: () => null }));
import { Sidebar } from '../../src/components/Sidebar';

beforeEach(() => {
  useGeneralSettings.setState({ language: 'zh-CN' });
  Object.assign(connection, {
    live: true,
    loadingUsage: false,
    usageLoaded: false,
    usage: null,
    usageError: null,
  });
});
const render = () =>
  renderToStaticMarkup(
    <Sidebar
      userName="Synthetic"
      accountLabel="synthetic@example.test"
      page="preparation"
      collapsed={false}
      onNavigate={() => {}}
      onCollapse={() => {}}
      onNew={() => {}}
      onSettings={() => {}}
      onLogout={() => {}}
    />,
  );
const summary = () => render().match(/<small(?: class="[^"]*")?>(.*?)<\/small>/)?.[1];

it('侧栏仅首次读取显示提示，后台刷新原样保留单周期低额度', () => {
  connection.loadingUsage = true;
  expect(render()).toContain('正在读取 AI 服务用量…');
  connection.usage = chatGPTAccountUsage({
    rateLimits: { primary: { usedPercent: 81, windowDurationMins: 10080 } },
  });
  connection.usageLoaded = true;
  connection.loadingUsage = false;
  const previous = summary();
  connection.loadingUsage = true;
  expect(summary()).toBe(previous);
  expect(render()).not.toContain('正在读取 AI 服务用量');
  expect(render()).toContain('account-usage-percent is-low">19%');
  expect(render()).not.toContain('account-usage-summary is-low');
});

it('后台刷新保留双周期布局与各自低百分比，成功值直接替换', () => {
  connection.usageLoaded = true;
  connection.usage = chatGPTAccountUsage({
    rateLimits: {
      primary: { usedPercent: 29, windowDurationMins: 300 },
      secondary: { usedPercent: 81, windowDurationMins: 10080 },
    },
  });
  const previous = summary();
  connection.loadingUsage = true;
  expect(summary()).toBe(previous);
  expect(render()).toContain('account-usage-value">5小时 71%');
  expect(render()).toContain('account-usage-value is-low">每周 19%');
  connection.usage = chatGPTAccountUsage({
    rateLimits: { primary: { usedPercent: 35, windowDurationMins: 300 } },
  });
  connection.loadingUsage = false;
  expect(render()).toContain('剩余 65%');
  expect(render()).not.toContain('每周 19%');
});

it('读取失败展示正常错误，重试不重复初始提示，也不显示旧额度或虚假零值', () => {
  connection.usageLoaded = true;
  connection.usageError = '合成额度读取失败';
  expect(render()).toContain('合成额度读取失败');
  connection.loadingUsage = true;
  expect(render()).toContain('合成额度读取失败');
  expect(render()).not.toMatch(/正在读取 AI 服务用量|剩余 0%/);
  connection.usageError = null;
  expect(render()).toContain('AI 服务用量暂不可用');
  expect(render()).not.toContain('正在读取 AI 服务用量');
});

import { useChatConnection } from '../stores/chatConnection';
import { openChatLink } from '../services/chat';
export function UsagePanel() {
  const state = useChatConnection();
  if (!state.live) return null;
  return (
    <section className="usage-panel" aria-label="本应用用量">
      <header>
        <span>本应用用量</span>
        <button
          aria-label="刷新用量"
          onClick={() => {
            void state.refreshUsage();
          }}
        >
          刷新
        </button>
      </header>
      <strong>
        {state.usage.totalTokens.toLocaleString()} <small>token</small>
      </strong>
      <div>
        <span>输入 {state.usage.inputTokens.toLocaleString()}</span>
        <span>输出 {state.usage.outputTokens.toLocaleString()}</span>
      </div>
      <p>{state.usageError ? '用量暂不可用' : `${state.usage.requests} 次已返回用量的请求`}</p>
      <small>仅统计本机本应用，未返回的用量不计入。</small>
      <button
        className="account-usage-link"
        onClick={() => {
          void openChatLink('https://chatgpt.com/settings/usage').catch(() => {});
        }}
      >
        查看账户用量 ↗
      </button>
      {state.usageError && (
        <span className="usage-error" title={state.usageError}>
          {state.usageError}
        </span>
      )}
    </section>
  );
}

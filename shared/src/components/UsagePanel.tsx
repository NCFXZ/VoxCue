import { useEffect } from 'react';
import { useChatConnection } from '../stores/chatConnection';
import { usePreparation } from '../stores/preparation';
import { openChatLink } from '../services/chat';
import { Button } from './ui/button';
import { ConfirmResetButton } from './ui/confirm-delete-button';
import { useModelProvider } from './useModelProvider';
import { ChevronRight } from './icons';
export function UsagePanel() {
  const state = useChatConnection();
  const provider = useModelProvider();
  const streaming = usePreparation((value) => value.streaming);
  useEffect(() => {
    void state.refreshUsage();
  }, [state.live]);
  return (
    <section className="usage-panel settings-usage" aria-label="本应用用量">
      <header>
        <strong>本应用用量</strong>
        <div className="usage-actions">
          <Button
            variant="ghost"
            disabled={!state.live || state.resettingUsage}
            onClick={() => void state.refreshUsage()}
            aria-label="刷新用量"
          >
            刷新
          </Button>
          <ConfirmResetButton
            target="本应用的本地用量统计"
            label="重置"
            disabled={!state.live || streaming || state.resettingUsage}
            active={state.live}
            warning={`清零后无法撤销，不影响 ${provider.name} 账户额度、聊天或个人资料`}
            onConfirm={() => state.resetUsage()}
            aria-label="重置用量"
          />
        </div>
      </header>
      <strong>
        {state.usage.totalTokens.toLocaleString()} <small>token</small>
      </strong>
      <div>
        <span>输入 {state.usage.inputTokens.toLocaleString()}</span>
        <span>输出 {state.usage.outputTokens.toLocaleString()}</span>
      </div>
      <p>{state.usage.requests} 次已返回用量的请求</p>
      <small>
        {state.live ? '仅统计本机本应用，未返回的用量不计入。' : '连接模型服务后可查看本机用量。'}
      </small>
      {state.live && ['chatgpt', 'copilot'].includes(provider.id) && (
        <Button
          variant="ghost"
          className="account-usage-link"
          onClick={() => {
            void openChatLink(
              provider.id === 'copilot'
                ? 'https://github.com/settings/copilot'
                : 'https://chatgpt.com/settings/usage',
            ).catch(() => {});
          }}
        >
          查看账户用量 <ChevronRight size={14} />
        </Button>
      )}
      {state.usageError && (
        <p className="usage-error" role="alert">
          {state.usageError}
        </p>
      )}
    </section>
  );
}

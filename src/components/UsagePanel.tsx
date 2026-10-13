import { useEffect, useState } from 'react';
import { useChatConnection } from '../stores/chatConnection';
import { usePreparation } from '../stores/preparation';
import { openChatLink } from '../services/chat';
import { Button } from './ui/button';
import { RotateCcw } from './icons';
export function UsagePanel() {
  const state = useChatConnection();
  const streaming = usePreparation((value) => value.streaming);
  const [confirm, setConfirm] = useState(false);
  const [reset, setReset] = useState(false);
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
          <Button
            variant="dangerGhost"
            disabled={!state.live || streaming || state.resettingUsage}
            onClick={() => {
              setConfirm(true);
              setReset(false);
            }}
            aria-label="重置用量"
            title={streaming ? '请等待回答完成或停止后重置' : '重置本机用量统计'}
          >
            <RotateCcw size={14} />
            重置
          </Button>
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
        {state.live ? '仅统计本机本应用，未返回的用量不计入。' : '连接 ChatGPT 后可查看本机用量。'}
      </small>
      {state.live && (
        <Button
          variant="ghost"
          className="account-usage-link"
          onClick={() => {
            void openChatLink('https://chatgpt.com/settings/usage').catch(() => {});
          }}
        >
          查看账户用量 ↗
        </Button>
      )}
      {confirm && (
        <div className="usage-reset-confirm" role="group" aria-label="确认重置用量">
          <p>
            确定清零本应用的本地用量统计？此操作无法撤销，不影响 ChatGPT 账户额度、聊天或个人资料。
          </p>
          <div className="usage-actions">
            <Button
              variant="outline"
              autoFocus
              disabled={state.resettingUsage}
              onClick={() => setConfirm(false)}
            >
              取消
            </Button>
            <Button
              variant="destructive"
              disabled={state.resettingUsage || streaming}
              onClick={async () => {
                if (await state.resetUsage()) {
                  setConfirm(false);
                  setReset(true);
                }
              }}
            >
              {state.resettingUsage ? '正在重置…' : '确认重置'}
            </Button>
          </div>
        </div>
      )}
      {reset && <p role="status">本地用量统计已重置</p>}
      {state.usageError && (
        <p className="usage-error" role="alert">
          {state.usageError}
        </p>
      )}
    </section>
  );
}

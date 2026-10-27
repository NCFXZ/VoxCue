import { useAuth } from '../stores/auth';
import { Button } from './ui/button';
import { UsagePanel } from './UsagePanel';
import { providerInfo } from '../services/providers';
import chatGPTIcon from '../assets/chatgpt.svg?inline';
import copilotIcon from '../assets/copilot.svg?inline';
import { Link, LogOut, X, Loader } from './icons';

export function AIServicePanel() {
  const auth = useAuth();
  const connected = auth.session?.mode !== 'demo' && auth.session?.mode;
  return (
    <div className="ai-services-panel">
      <p className="settings-hint">
        AI 服务独立授权，用于聊天与面试回答，不影响 VoxCue 主账号和云同步。
      </p>
      {(
        [
          ['chatgpt', chatGPTIcon],
          ['copilot', copilotIcon],
        ] as const
      ).map(([service, icon]) => (
        <div className="settings-entry ai-service-row" key={service}>
          <div className="ai-service-label">
            <img className="service-brand-icon" src={icon} alt="" />
            <div>
              <strong>{providerInfo(service).name}</strong>
              <p className="settings-hint">
                {connected === service ? auth.session?.user.email || '已连接' : '未连接'}
              </p>
            </div>
          </div>
          <div className="ai-service-actions">
            <Button
              variant="outline"
              disabled={auth.waiting}
              onClick={() => {
                void (connected === service ? auth.signOut() : auth.signIn(service));
              }}
            >
              {auth.signingIn === service ? (
                <Loader size={16} />
              ) : connected === service ? (
                <LogOut size={16} />
              ) : (
                <Link size={16} />
              )}
              {auth.signingIn === service
                ? '等待浏览器授权…'
                : connected === service
                  ? '断开连接'
                  : '连接'}
            </Button>
            {auth.signingIn === service && (
              <Button variant="ghost" onClick={() => void auth.cancel()}>
                <X size={16} />
                取消授权
              </Button>
            )}
          </div>
        </div>
      ))}
      {(auth.error || auth.notice) && (
        <p className="settings-error" role="alert">
          {auth.error || auth.notice}
        </p>
      )}
      {connected && <UsagePanel />}
    </div>
  );
}

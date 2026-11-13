import { t } from '../i18n';
import { useAuth } from '../stores/auth';
import { useCloudAccount } from '../stores/cloudAccount';
import { Button } from './ui/button';
import { UsagePanel } from './UsagePanel';
import { providerInfo } from '../services/providers';
import chatGPTIcon from '../assets/chatgpt.svg?inline';
import copilotIcon from '../assets/copilot.svg?inline';
import { Link, LogOut, X, Loader } from './icons';
import { uiMessages } from '../../electron/contracts/uiMessages';

const connectionNotices: Readonly<Record<string, string>> = {
  '无法读取本地登录信息，请检查应用数据后重试。': '无法读取登录信息，请重试。',
  '无法完成 GitHub Copilot 登录，请检查网络和 Copilot 权限后重试。': 'GitHub Copilot 连接失败，请重试。',
  'GitHub 授权地址校验失败，请重试。': 'GitHub 授权失败，请重试。',
  'GitHub 授权回调校验失败，请重试。': 'GitHub 授权失败，请重试。',
  '已有登录操作正在进行。': '正在登录，请稍候。',
  '登录已取消，请重试。': '登录已取消。',
  '已取消 ChatGPT 登录。': '登录已取消。',
  'GitHub Copilot 授权已失效或账户已变更，请重新登录。': '请重新登录 GitHub Copilot。',
  '未能确认 ChatGPT 授权已退出，可在官方账户设置中撤销应用授权。':
    '无法确认已断开连接。可在 ChatGPT 账户设置中撤销授权。',
};

function connectionText(notice: string) {
  if (Object.hasOwn(connectionNotices, notice)) return t(connectionNotices[notice]);
  return Object.hasOwn(uiMessages, notice) ? t(notice) : t('连接操作失败，请重试。');
}

export function AIServicePanel() {
  const auth = useAuth();
  const localMode = useCloudAccount((s) => s.state.localMode);
  const connected = auth.session?.mode !== 'demo' && auth.session?.mode;
  const notice = auth.connectionNotice || auth.error || auth.notice;
  return (
    <div className="ai-services-panel">
      <p className="settings-hint">
        {localMode
          ? t('使用本地账户时可独立连接 AI 服务，用于聊天与面试回答；云备份需另行登录 VoxCue。')
          : t('AI 服务独立授权，用于聊天与面试回答，不影响 VoxCue 主账号和云同步。')}
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
                {connected === service
                  ? auth.session?.user.email || t('已连接')
                  : t(auth.resolved || auth.startupChecked ? '未连接' : '暂未验证连接状态')}
              </p>
            </div>
          </div>
          <div className="ai-service-actions">
            <Button
              variant="outline"
              disabled={auth.waiting || auth.loading}
              onClick={() => {
                void (connected === service ? auth.signOut() : auth.connect(service));
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
                ? t('等待浏览器授权…')
                : connected === service
                  ? t('断开连接')
                  : t('连接')}
            </Button>
            {auth.signingIn === service && (
              <Button variant="ghost" onClick={() => void auth.cancel()}>
                <X size={16} />
                {t('取消授权')}
              </Button>
            )}
          </div>
        </div>
      ))}
      {notice && (
        <p className="settings-error" role="alert">
          {connectionText(notice)}
        </p>
      )}
      {connected && <UsagePanel />}
    </div>
  );
}

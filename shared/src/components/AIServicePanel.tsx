import { useEffect, useId, useRef, useState } from 'react';
import { isApiProvider } from '../../electron/contracts/apiConnections';
import { InterviewReveal } from './InterviewReveal';
import { t } from '../i18n';
import { useAuth } from '../stores/auth';
import { useChatConnection } from '../stores/chatConnection';
import type { AccountService } from '../../electron/contracts/auth';
import { useCloudAccount } from '../stores/cloudAccount';
import { Button } from './ui/button';
import { SegmentedControl } from './ui/segmented-control';
import { switchView } from './ui/switchView';
import { UsagePanel } from './UsagePanel';
import { ApiConnectionPanel } from './ApiConnectionPanel';
import { providerInfo } from '../services/providers';
import chatGPTIcon from '../assets/chatgpt.svg?inline';
import copilotIcon from '../assets/copilot.svg?inline';
import { LogIn, LogOut, Play, Square, X } from './icons';
import { uiMessages } from '../../electron/contracts/uiMessages';

const connectionNotices: Readonly<Record<string, string>> = {
  '无法读取本地登录信息，请检查应用数据后重试。': '无法读取登录信息，请重试。',
  '无法完成 GitHub Copilot 登录，请检查网络和 Copilot 权限后重试。':
    'GitHub Copilot 连接失败，请重试。',
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

const methods = [
  { value: 'account', label: '账号授权' },
  { value: 'api', label: 'API 密钥' },
] as const;
const accountServices = [
  ['chatgpt', chatGPTIcon],
  ['copilot', copilotIcon],
] as const;
type ConnectionView = (typeof methods)[number]['value'];

export function AIServicePanel() {
  const auth = useAuth();
  const localMode = useCloudAccount((s) => s.state.localMode);
  const connected = auth.session?.mode !== 'demo' && auth.session?.mode;
  const [expanded, setExpanded] = useState<AccountService | null>(() =>
    connected === 'chatgpt' || connected === 'copilot' ? connected : null,
  );
  const expandedSaved = !!expanded && (expanded === connected || auth.accounts.includes(expanded));
  const [choice, setChoice] = useState<ConnectionView>();
  const label = useId();
  const content = useRef<HTMLDivElement>(null);
  const requested = useRef<ConnectionView | undefined>(undefined);
  const initial = isApiProvider(connected) ? 'api' : 'account';
  const method = choice ?? initial;
  useEffect(() => {
    if (method !== 'account' || auth.waiting || !expanded || !expandedSaved) return;
    const state = useChatConnection.getState();
    if (expanded === connected) void state.refreshUsage();
    else void state.refreshSavedUsage(expanded);
    return () => { if (expanded !== connected) state.clearSavedUsage(expanded); };
  }, [method, auth.waiting, expanded, expandedSaved, connected, auth.session?.user.id]);
  useEffect(() => { void auth.loadAccounts(); }, [auth.loadAccounts]);
  useEffect(() => {
    if (auth.resolved || auth.startupChecked) setChoice((previous) => previous ?? initial);
  }, [auth.resolved, auth.startupChecked, initial]);
  const selectMethod = (next: ConnectionView) => {
    if ((requested.current ?? method) === next) return;
    requested.current = next;
    switchView(
      content.current,
      () => setChoice(next),
      next === 'api' ? 'forward' : 'back',
      'independent',
    );
  };
  const notice = auth.connectionNotice || auth.error || auth.notice;
  return (
    <div className="ai-services-panel">
      <p className="settings-hint">
        {localMode
          ? t('使用本地账户时可独立连接 AI 服务，用于聊天与面试回答；云备份需另行登录 VoxCue。')
          : t('AI 服务独立授权，用于聊天与面试回答，不影响 VoxCue 主账号和云同步。')}
      </p>
      <div className="settings-entry">
        <strong id={label}>{t('登录方式')}</strong>
        <SegmentedControl
          labelledBy={label}
          options={methods}
          value={method}
          onChange={selectMethod}
        />
      </div>
      <div ref={content}>
        {method === 'api' ? (
          <ApiConnectionPanel />
        ) : accountServices.map(([service, icon]) => {
          const name = providerInfo(service).name;
          const active = connected === service;
          const saved = active || auth.accounts.includes(service);
          const open = saved && expanded === service;
          const user = active ? auth.session?.user : auth.accountUsers[service];
          const identity = user?.email || user?.name;
          return (
            <div className="account-service" role="group" aria-label={name} key={service}>
              <div className="settings-entry ai-service-row" data-settings-target={service}>
                <button type="button" className="ai-service-label api-service-disclosure"
                  disabled={!saved} aria-expanded={open} aria-controls={'account-settings-' + service}
                  onClick={() => setExpanded(open ? null : service)}>
                  <img className="service-brand-icon" src={icon} alt="" />
                  <span>
                    <strong>{name}</strong>
                    <span className="settings-hint">
                      {identity || t(active ? '当前使用中' : saved ? '已登录'
                        : auth.accountsLoaded ? '未登录' : '暂未验证登录状态')}
                    </span>
                  </span>
                </button>
                <div className="ai-service-actions">
                  {auth.signingIn === service ? (
                    <>
                      <span className="settings-hint" role="status">
                        {t('等待浏览器授权…')}
                      </span>
                      <Button variant="ghost" onClick={() => void auth.cancel()}>
                        <X size={16} />
                        {t('取消授权')}
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button
                        variant="outline"
                        disabled={auth.waiting || auth.loading}
                        onClick={() => void (async () => {
                          if (active) {
                            if (await auth.disable()) setExpanded(selected => selected === service ? null : selected);
                          } else {
                            await auth.connect(service);
                            if (useAuth.getState().session?.mode === service)
                              setExpanded(selected => selected === expanded ? service : selected);
                          }
                        })()}
                      >
                        {active ? <Square size={16} /> : saved ? <Play size={16} /> : <LogIn size={16} />}
                        {t(active ? '禁用' : saved ? '启用' : '登录')}
                      </Button>
                      {saved && (
                        <Button variant="outline" disabled={auth.waiting || auth.loading}
                          onClick={() => void auth.signOut(service).then(done => {
                            if (done) setExpanded(selected => selected === service ? null : selected);
                          })}>
                          <LogOut size={16} />
                          {t('退出登录')}
                        </Button>
                      )}
                    </>
                  )}
                </div>
              </div>
              <div id={'account-settings-' + service}>
                <InterviewReveal>{open ? <UsagePanel service={service} /> : null}</InterviewReveal>
              </div>
            </div>
          );
        })}
      </div>
      <InterviewReveal resizeKey={notice ?? ''}>
        {notice ? (
          <p className="settings-error" role="alert">
            {connectionText(notice)}
          </p>
        ) : null}
      </InterviewReveal>
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import {
  apiProviderIds,
  apiProviders,
  isApiProvider,
  type ApiBalance,
  type ApiConnectionConfig,
  type ApiProvider,
} from '../../electron/contracts/apiConnections';
import type { AppUsage } from '../../electron/contracts/chat';
import { t, uiLocale } from '../i18n';
import { apiConnections } from '../services/apiConnections';
import { userError } from '../services/errors';
import { useAuth } from '../stores/auth';
import { useChatConnection } from '../stores/chatConnection';
import { Button } from './ui/button';
import { ConfirmDeleteButton } from './ui/confirm-delete-button';
import { ArrowUpRight, Edit, Play, Plus, Refresh, Square } from './icons';
import { ProviderIcon } from './ProviderIcon';
import { ApiKeyDialog } from './ApiKeyDialog';
import { InterviewReveal } from './InterviewReveal';
import { useHeightTransition } from './ui/useHeightTransition';

const localMetrics = [
  ['requests', '本机请求'],
  ['inputTokens', '输入 token'],
  ['outputTokens', '输出 token'],
] as const;

export function ApiUsageValues({ balance, local }: { balance?: string | ApiBalance[]; local?: AppUsage | string }) {
  return (
    <dl className="api-usage-values">
      {balance !== undefined && (
        <div className="api-usage-line">
          <dt>{t('账户余额')}</dt>
          <dd>
            {typeof balance === 'string' ? balance : [...balance]
              .sort((a, b) => {
                const rank = (currency: string) => currency === 'CNY' ? 0 : currency === 'USD' ? 1 : 2;
                return rank(a.currency) - rank(b.currency);
              })
              .map(({ currency, total }, index) => (
                <span className="api-balance-value" key={`${currency}-${index}`}>{total} {currency}</span>
              ))}
          </dd>
        </div>
      )}
      {local !== undefined && localMetrics.map(([field, label]) => (
        <div className="api-usage-line" key={field}>
          <dt>{t(label)}</dt>
          <dd>{typeof local === 'string' ? local : local[field].toLocaleString(uiLocale())}</dd>
        </div>
      ))}
    </dl>
  );
}

function ApiUsage({ connection, active }: { connection: ApiConnectionConfig; active: boolean }) {
  const { provider } = connection;
  const [refresh, setRefresh] = useState(0);
  const [usage, setUsage] = useState<AppUsage>();
  const [balances, setBalances] = useState<ApiBalance[]>();
  const [balanceError, setBalanceError] = useState('');
  const [usageError, setUsageError] = useState('');
  const [busy, setBusy] = useState(true);
  const balance = apiProviders[provider].balance;
  const usageCard = useRef<HTMLElement>(null);
  useHeightTransition(`${busy}:${balances?.length ?? 0}:${!!usage}:${balanceError}:${usageError}:${active}`,
    () => balance ? [usageCard.current] : []);
  useEffect(() => {
    let current = true;
    setBusy(true);
    setUsage(undefined);
    setBalances(undefined);
    setBalanceError('');
    setUsageError('');
    const pending: Promise<void>[] = [];
    if (active) {
      pending.push(
        apiConnections.localUsage().then(
          (value) => {
            if (current) setUsage(value);
          },
          (error) => {
            if (current) setUsageError(userError(error, '用量暂不可用。'));
          },
        ),
      );
    }
    if (balance) {
      pending.push(
        apiConnections.balance(provider).then(
          (values) => {
            if (current) setBalances(values);
          },
          (error) => {
            if (current) setBalanceError(userError(error, '余额暂不可用。'));
          },
        ),
      );
    }
    void Promise.all(pending).finally(() => {
      if (current) setBusy(false);
    });
    return () => {
      current = false;
    };
  }, [connection, provider, active, balance, refresh]);
  if (!active && !balance) return null;
  const balanceValue = balances?.length
    ? balances
    : t(busy && !balances && !balanceError ? '读取中…' : '暂不可用');
  const localValue = usage ?? t(busy && !usageError ? '读取中…' : '暂不可用');
  return (
    <section ref={usageCard} className="api-usage account-quota" aria-label={t('API 用量')} aria-busy={busy}>
      <header>
        <strong>{t('API 用量')}</strong>
        <Button
          type="button"
          variant="ghost"
          disabled={busy}
          aria-label={t('刷新用量')}
          onClick={() => setRefresh((value) => value + 1)}
        >
          <Refresh size={16} />
          {t(busy ? '刷新中…' : '刷新')}
        </Button>
      </header>
      <ApiUsageValues balance={balance ? balanceValue : undefined} local={active ? localValue : undefined} />
      <InterviewReveal>
        {balanceError ? <p className="settings-error" role="status">{t(balanceError)}</p> : null}
      </InterviewReveal>
      <InterviewReveal>
        {usageError ? <p className="settings-error" role="status">{t(usageError)}</p> : null}
      </InterviewReveal>
    </section>
  );
}

export function ApiProviderSettings({
  provider,
  saved,
  onChange,
  expanded,
  onExpand,
  known,
}: {
  provider: ApiProvider;
  saved?: ApiConnectionConfig;
  onChange(config?: ApiConnectionConfig): void;
  expanded: boolean;
  onExpand(open: boolean): void;
  known: boolean;
}) {
  const auth = useAuth();
  const active = auth.session?.mode === provider;
  const [promptConfig, setPromptConfig] = useState<ApiConnectionConfig>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const locked = !known || busy || auth.waiting || auth.loading;
  const name = t(apiProviders[provider].name);
  async function run(operation: () => Promise<void | boolean>) {
    if (locked) return false;
    setBusy(true);
    setError('');
    try {
      return (await operation()) !== false;
    } catch (e) {
      setError(userError(e, '连接操作失败，请重试。'));
      return false;
    } finally {
      setBusy(false);
    }
  }
  const configure = () => setPromptConfig({ provider });
  const remove = async () => {
    if (active && !(await auth.disable())) return false;
    await apiConnections.remove(provider);
    onExpand(false);
    onChange();
  };
  return (
    <div className="api-service" role="group" aria-label={name}>
      <div className="settings-entry ai-service-row">
        <button
          type="button"
          className="ai-service-label api-service-disclosure"
          aria-expanded={expanded}
          aria-controls={'api-settings-' + provider}
          onClick={() => onExpand(!expanded)}
        >
          <ProviderIcon provider={provider} />
          <span>
            <strong>{name}</strong>
            <span className="settings-hint">
              {t(active ? '当前使用中' : !known ? '暂未验证连接状态' : saved ? '已配置' : '未配置')}
            </span>
          </span>
        </button>
        <div className="ai-service-actions">
          <Button
            variant="outline"
            disabled={locked || !saved}
            onClick={() =>
              void run(async () => {
                if (active) {
                  if (await auth.disable()) onExpand(false);
                } else {
                  await auth.connect(provider);
                  if (useAuth.getState().session?.mode === provider) onExpand(true);
                }
              })
            }
          >
            {active ? <Square size={16} /> : <Play size={16} />}
            {t(active ? '禁用' : '启用')}
          </Button>
          {saved ? (
            <ConfirmDeleteButton
              target={name}
              label="移除密钥"
              warning="仅移除此设备保存的密钥"
              iconOnly={false}
              iconSize={16}
              fixedWidth
              revision={saved}
              disabled={locked}
              onConfirm={() => run(remove)}
            />
          ) : (
            <Button
              variant="outline"
              disabled={locked}
              onClick={configure}
            >
              <Plus size={16} />
              {t('添加密钥')}
            </Button>
          )}
        </div>
      </div>
      <div id={'api-settings-' + provider}>
        <InterviewReveal>
          {expanded ? (
            <div className="api-service-details">
              {saved && <ApiUsage connection={saved} active={active} />}
              <div className="api-detail-row">
                <span>{t('API 密钥')}</span>
                <div className="api-key-value">
                  {saved && <span className="api-key-mask" aria-hidden="true">•••• ••••</span>}
                  <button
                    type="button"
                    className="api-text-action"
                    disabled={locked}
                    onClick={configure}
                  >
                    {saved && <Edit size={13} />}
                    {t(saved ? '更换密钥' : '输入 API 密钥')}
                  </button>
                </div>
                <div className="api-links">
                  <button
                    type="button"
                    className="api-text-action"
                    aria-label={t('获取 API 密钥')}
                    disabled={locked}
                    onClick={() => void run(() => apiConnections.open(provider, 'keys'))}
                  >
                    {t('获取密钥')}
                    <ArrowUpRight size={12} />
                  </button>
                  <button
                    type="button"
                    className="api-text-action"
                    aria-label={t('查看官方账单')}
                    disabled={locked}
                    onClick={() => void run(() => apiConnections.open(provider, 'billing'))}
                  >
                    {t('官方账单')}
                    <ArrowUpRight size={12} />
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </InterviewReveal>
      </div>
      <InterviewReveal>
        {error ? (
          <p role="alert" className="settings-error">
            {t(error)}
          </p>
        ) : null}
      </InterviewReveal>
      {promptConfig && (
        <ApiKeyDialog
          config={promptConfig}
          replacing={!!saved}
          onFinish={(ok) => {
            setPromptConfig(undefined);
            if (!ok) return;
            onChange(promptConfig);
            onExpand(true);
            if (useAuth.getState().session?.mode === provider)
              void useChatConnection.getState().load(true, true, provider);
          }}
        />
      )}
    </div>
  );
}

export function ApiConnectionPanel() {
  const current = useAuth((state) => state.session?.mode);
  const [expanded, setExpanded] = useState<ApiProvider | null>(() =>
    isApiProvider(current) ? current : null,
  );
  const [connections, setConnections] = useState<ApiConnectionConfig[]>();
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let mounted = true;
    setError('');
    void apiConnections.list().then(
      (value) => {
        if (mounted) setConnections(value);
      },
      (e) => {
        if (mounted) setError(userError(e, '无法读取 API 连接。'));
      },
    );
    return () => {
      mounted = false;
    };
  }, [retry]);
  return (
    <section className="api-connections" aria-label={t('API 密钥')}>
      <InterviewReveal>
        {error ? (
          <div className="settings-entry">
            <span role="alert">{t(error)}</span>
            <Button variant="ghost" onClick={() => setRetry((value) => value + 1)}>
              {t('重试')}
            </Button>
          </div>
        ) : null}
      </InterviewReveal>
      {apiProviderIds.map((provider) => (
        <ApiProviderSettings
          key={provider + String(!!connections)}
          provider={provider}
          saved={connections?.find((item) => item.provider === provider)}
          known={!!connections}
          expanded={expanded === provider}
          onExpand={(open) => setExpanded((selected) => {
            // A pending service action must respect a newer disclosure selection.
            if (open) return selected === expanded ? provider : selected;
            return selected === provider ? null : selected;
          })}
          onChange={(config) =>
            setConnections((previous) => [
              ...(previous ?? []).filter((item) => item.provider !== provider),
              ...(config ? [config] : []),
            ])
          }
        />
      ))}
    </section>
  );
}

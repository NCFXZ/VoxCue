import { useEffect, useId, useRef, useState } from 'react';
import type { AccountImportSource } from '../../electron/contracts/accountData';
import { InterviewReveal } from './InterviewReveal';
import { t } from '../i18n';
import {
  closeAccountImport,
  listAccountImportSources,
  openAccountImport,
  restoreAccountImport,
  previewAccountImport,
  type ImportPreviewEntry,
  type AccountImport,
} from '../services/accountImport';
import { ArrowRightLeft, ChevronRight, ShieldCheck, X } from './icons';
import { AccountMigrationConflicts, AccountMigrationSelection } from './AccountMigrationSelection';
import { ChoiceMenu } from './ui/choice-menu';
import { Button } from './ui/button';
import { Modal } from './ui/modal';
import { PasswordInput } from './ui/password-input';

export function migrationSourceOptions(sources: readonly AccountImportSource[]) {
  const counts = new Map<string, number>();
  return sources.map((source) => {
    let label = source.id === 'local' ? t('本地账户') : t('VoxCue 账号');
    if (source.email) {
      const [local, domain] = source.email.split('@');
      const prefix = local.slice(0, Math.min(2, Math.floor(local.length / 2)));
      const suffix = local.length >= 5 ? local.slice(-1) : '';
      const masked = prefix + '***' + suffix;
      label = (masked === local ? prefix + '***' : masked) + '@' + domain;
    }
    const number = (counts.get(label) ?? 0) + 1;
    counts.set(label, number);
    return { value: source.id, label: number === 1 ? label : label + ' (' + number + ')' };
  });
}

export function AccountMigrationPanel({
  disabled,
  onBusy,
}: {
  disabled: boolean;
  onBusy(value: boolean): void;
}) {
  const [step, setStep] = useState<'closed' | 'source' | 'password' | 'items'>('closed');
  const [sourceId, setSourceId] = useState('');
  const [confirmReplacement, setConfirmReplacement] = useState(false);
  const [sources, setSources] = useState<ReturnType<typeof migrationSourceOptions>>([]);
  const [entries, setEntries] = useState<ImportPreviewEntry[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [password, setPassword] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const passwordId = useId();
  const form = useId();
  const passwordInput = useRef<HTMLInputElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const choice = sources.find((source) => source.value === sourceId);
  const conflicts = entries.filter((entry) => entry.conflict && selected.has(entry.key));
  const alive = useRef(true);
  const pending = useRef<AccountImport | null>(null);
  const locked = useRef(false);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (!locked.current) releasePending();
    };
  }, []);
  useEffect(() => {
    if (busy || !content.current) return;
    if (step === 'password') passwordInput.current?.focus();
    if (step === 'source') content.current.querySelector<HTMLElement>('.choice-trigger')?.focus();
    if (step === 'items') {
      const first =
        content.current.querySelector<HTMLElement>('.selection-group-heading input:enabled') ??
        content.current
          .closest('dialog')
          ?.querySelector<HTMLElement>('.modal-footer button:enabled');
      first?.focus({ preventScroll: true });
    }
  }, [step, busy]);

  async function releasePending() {
    const current = pending.current;
    pending.current = null;
    if (current) await closeAccountImport(current.token).catch(() => {});
  }
  function working(value: boolean) {
    locked.current = value;
    if (alive.current) {
      onBusy(value);
      setBusy(value);
    } else if (!value) releasePending();
  }
  function failed(cause: unknown) {
    if (alive.current) setError(cause instanceof Error ? cause.message : '资料迁移失败，请重试。');
  }
  async function show() {
    if (disabled || locked.current) return;
    working(true);
    setStep('source');
    setError('');
    setMessage('');
    setSources([]);
    try {
      const available = await listAccountImportSources();
      if (alive.current) {
        setSources(migrationSourceOptions(available));
        setSourceId(available[0]?.id ?? '');
      }
    } catch (cause) {
      failed(cause);
    } finally {
      working(false);
    }
  }
  async function preview(session: AccountImport, secret?: string) {
    const data = await previewAccountImport(session, secret, () => alive.current);
    if (alive.current) {
      setEntries(data);
      setSelected(new Set(data.map((entry) => entry.key)));
      setStep('items');
    }
  }
  async function choose() {
    if (locked.current || !choice) return;
    working(true);
    setError('');
    try {
      const session = await openAccountImport(choice.value);
      pending.current = session;
      if (!alive.current) return;
      if (session.requiresPassword) setStep('password');
      else await preview(session);
    } catch (cause) {
      await releasePending();
      failed(cause);
    } finally {
      working(false);
    }
  }
  async function verify() {
    const session = pending.current;
    if (locked.current || !session || !password) return;
    working(true);
    setPasswordVisible(false);
    setError('');
    setPassword('');
    try {
      await preview(session, password);
    } catch (cause) {
      failed(cause);
    } finally {
      working(false);
    }
  }
  function clearChoices() {
    setEntries([]);
    setSelected(new Set());
    setConfirmReplacement(false);
    setPassword('');
    setPasswordVisible(false);
  }
  async function dismiss() {
    if (locked.current) return;
    working(true);
    setError('');
    try {
      if (pending.current) await closeAccountImport(pending.current.token);
    } catch (cause) {
      failed(cause);
    } finally {
      pending.current = null;
      if (alive.current) {
        clearChoices();
        setStep('closed');
      }
      working(false);
    }
  }
  function toggleItems(keys: string[], checked: boolean) {
    setSelected((previous) => {
      const next = new Set(previous);
      for (const key of keys) {
        if (checked) next.add(key);
        else next.delete(key);
      }
      return next;
    });
  }
  async function migrate(replace: boolean) {
    const session = pending.current;
    if (locked.current || !session || !selected.size) return;
    if (conflicts.length && !replace) {
      setConfirmReplacement(true);
      return;
    }
    working(true);
    setError('');
    // Restore owns the session from here until it commits or rolls back.
    pending.current = null;
    try {
      await restoreAccountImport(
        session,
        [...selected],
        conflicts.map((entry) => entry.key),
        () => alive.current,
      );
      if (alive.current) {
        setStep('closed');
        setMessage('资料已迁移。');
      }
    } catch (cause) {
      failed(cause);
      if (alive.current) setStep('source');
    } finally {
      if (alive.current) clearChoices();
      working(false);
    }
  }
  return (
    <section className="account-migration-panel" aria-label={t('数据迁移')}>
      <div className="settings-entry" data-settings-target="account-migration">
        <div>
          <strong>{t('数据迁移')}</strong>
          <p className="settings-hint">{t('从这台设备的其他账户迁移资料。')}</p>
        </div>
        <Button variant="outline" disabled={disabled || busy} onClick={() => void show()}>
          <ArrowRightLeft size={16} />
          {t('数据迁移')}
        </Button>
      </div>
      <InterviewReveal>
        {message ? (
          <p role="status" className="settings-hint">
            {t(message)}
          </p>
        ) : null}
      </InterviewReveal>
      <InterviewReveal>
        {step === 'closed' && error ? (
          <p role="alert" className="danger-text">
            {t(error)}
          </p>
        ) : null}
      </InterviewReveal>
      {step !== 'closed' && (
        <Modal
          title={t('数据迁移')}
          contentRef={content}
          subtitle="迁移后，本机来源账户的所选资料将被删除，云端副本保留。"
          overlayHeader
          className="account-delete-dialog account-migration-dialog account-migration-wizard"
          onClose={dismiss}
          footer={
            <>
              <Button variant="outline" disabled={busy} onClick={dismiss}>
                <X size={16} />
                {t('取消')}
              </Button>
              {step === 'source' && (
                <Button disabled={busy || !choice} onClick={() => void choose()}>
                  <ChevronRight size={16} />
                  {t('下一步')}
                </Button>
              )}
              {step === 'password' && (
                <Button type="submit" form={form} disabled={busy || !password}>
                  <ShieldCheck size={16} />
                  {busy ? t('正在验证…') : t('验证密码')}
                </Button>
              )}
              {step === 'items' && (
                <Button disabled={busy || !selected.size} onClick={() => void migrate(false)}>
                  <ArrowRightLeft size={16} />
                  {busy ? t('正在迁移…') : t('确认迁移')}
                </Button>
              )}
            </>
          }
        >
          {step === 'source' &&
            (sources.length ? (
              <div className="migration-source-row">
                <span>{t('来源账号')}</span>
                <ChoiceMenu
                  label="来源账号"
                  extendOutsideDialog
                  value={sourceId}
                  options={sources}
                  disabled={busy}
                  onChange={setSourceId}
                />
              </div>
            ) : (
              <InterviewReveal resizeKey={busy ? 'loading' : error || 'empty'}>
                {busy ? <p role="status">{t('正在查找本机账户…')}</p> :
                  error ? <p role="alert" className="danger-text">{t(error)}</p> :
                    <p>{t('这台设备上没有其他可迁移的账户。')}</p>}
              </InterviewReveal>
            ))}
          {step === 'password' && choice && (
            <form
              id={form}
              onSubmit={(event) => {
                event.preventDefault();
                void verify();
              }}
            >
              <div className="cloud-account-form">
                <label htmlFor={passwordId}>{t('输入 {0} 的 VoxCue 密码', [choice.label])}</label>
                <PasswordInput
                  id={passwordId}
                  inputRef={passwordInput}
                  visible={passwordVisible}
                  onVisibilityChange={setPasswordVisible}
                  autoComplete="off"
                  maxLength={1024}
                  value={password}
                  disabled={busy}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </div>
            </form>
          )}
          {step === 'items' &&
            (entries.length ? (
              <AccountMigrationSelection
                entries={entries}
                selected={selected}
                onSelect={toggleItems}
                disabled={busy}
              />
            ) : (
              <p>{t('这个账户在本机没有可迁移的资料。')}</p>
            ))}
          <InterviewReveal resizeKey={error}>
            {error && (step !== 'source' || sources.length > 0) ? (
              <p role="alert" className="danger-text">
                {t(error)}
              </p>
            ) : null}
          </InterviewReveal>
        </Modal>
      )}
      {confirmReplacement && (
        <Modal
          title={t('替换冲突资料')}
          overlayHeader
          className="account-delete-dialog account-migration-dialog"
          onClose={() => {
            if (!locked.current) setConfirmReplacement(false);
          }}
          footer={
            <>
              <Button
                variant="outline"
                data-autofocus
                disabled={busy}
                onClick={() => setConfirmReplacement(false)}
              >
                <X size={16} />
                {t('取消')}
              </Button>
              <Button variant="destructive" disabled={busy} onClick={() => void migrate(true)}>
                <ArrowRightLeft size={16} />
                {busy ? t('正在迁移…') : t('替换并迁移')}
              </Button>
            </>
          }
        >
          <p>
            {t('所选资料中有 {0} 项冲突。替换后，当前账号中这些条目的现有资料将丢失。', [
              conflicts.length,
            ])}
          </p>
          <AccountMigrationConflicts conflicts={conflicts} />
        </Modal>
      )}
    </section>
  );
}

import { useState } from 'react';
import { useCloudUsage } from '../stores/cloudUsage';
import { Button } from './ui/button';
import { Refresh, Check } from './icons';

export function CloudUsagePanel() {
  const { value, error, busy, run } = useCloudUsage();
  const [code, setCode] = useState('');
  return (
    <section className="cloud-account-panel account-quota-section" aria-label="面试额度">
      <h3>面试额度</h3>
      <div className="settings-entry">
        <div>
          <strong>
            {value
              ? value.permanent
                ? '永久额度'
                : `${Math.floor(Number(value.remainingSeconds) / 3600)} 小时 ${Math.floor((Number(value.remainingSeconds) % 3600) / 60)} 分`
              : '尚未读取'}
          </strong>
          <p className="settings-hint">仅面试时扣除额度。</p>
          {value?.cloudDeleteAfter && (
            <p className="settings-hint">
              云端数据保留至 {new Date(value.cloudDeleteAfter).toLocaleDateString()}
              ，本地数据不会被删除。
            </p>
          )}
        </div>
        <Button variant="ghost" disabled={busy} onClick={() => void run({ action: 'status' })}>
          <Refresh size={16} />
          刷新额度
        </Button>
      </div>
      <form
        className="cloud-account-form"
        onSubmit={(e) => {
          e.preventDefault();
          void run({ action: 'redeem', code: code.trim() }).then((ok) => {
            if (ok) setCode('');
          });
        }}
      >
        <label>
          面试额度激活码
          <input
            value={code}
            maxLength={96}
            autoComplete="off"
            disabled={busy}
            onChange={(e) => setCode(e.target.value.replace(/\s/g, ''))}
            placeholder="VC1_…"
          />
        </label>
        <Button variant="outline" disabled={busy || !/^VC1_[A-Za-z0-9_-]{43}$/.test(code.trim())}>
          <Check size={16} />
          兑换额度
        </Button>
      </form>
      {error && (
        <p className="danger-text" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

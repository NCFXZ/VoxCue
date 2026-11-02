import { t } from '../i18n';
import { useCloudSync } from '../stores/cloudSync';
const kinds = [
  ['profile', '个人信息'],
  ['history', '面试记录'],
  ['knowledgebase', '知识库'],
] as const;
const bytes = (value: number) => `${(value / 1_000_000).toFixed(2)} MB`;
export function CloudStorageSummary() {
  const storage = useCloudSync((s) => s.storage);
  const used = storage ? kinds.reduce((sum, [kind]) => sum + storage.storedBytes[kind], 0) : 0;
  const capacity = storage?.capacityBytes || 0;
  const scale = Math.max(capacity, used);
  return (
    <section className="cloud-storage-summary" aria-label={t('云端容量')}>
      <div className="cloud-storage-heading">
        <strong>{t('云端存储')}</strong>
      </div>
      <div
        className="cloud-storage-bar"
        role="img"
        aria-label={
          storage ? t('已用 {0} 字节，总容量 {1} 字节', [used, capacity]) : t('正在读取云端容量')
        }
      >
        {kinds.map(([kind]) => (
          <span
            key={kind}
            className={`storage-${kind}`}
            style={{
              width: `${scale ? Math.min(100, (storage!.storedBytes[kind] / scale) * 100) : 0}%`,
            }}
          />
        ))}
      </div>
      <div className="cloud-storage-details">
        <div className="cloud-storage-legend">
          {kinds.map(([kind, label]) => (
            <span key={kind}>
              <i className={`storage-${kind}`} />
              {t(label)}
              {storage ? ` ${bytes(storage.storedBytes[kind])}` : ''}
            </span>
          ))}
        </div>
        <span>
          {storage ? (
            <>
              {t('可用 ')}
              {bytes(Math.max(0, capacity - used))}
              {t(' · 已用 ')}
              {bytes(used)}
            </>
          ) : (
            t('容量尚未读取')
          )}
        </span>
      </div>
    </section>
  );
}

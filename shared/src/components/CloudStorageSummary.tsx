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
  return (
    <section className="cloud-storage-summary" aria-label="云端容量">
      <div className="cloud-storage-heading">
        <strong>云端存储</strong>
      </div>
      <div
        className="cloud-storage-bar"
        role="img"
        aria-label={storage ? `已用 ${used} 字节，总容量 ${capacity} 字节` : '正在读取云端容量'}
      >
        {kinds.map(([kind, label]) => (
          <span
            key={kind}
            className={`storage-${kind}`}
            style={{
              width: `${capacity ? Math.min(100, (storage!.storedBytes[kind] / capacity) * 100) : 0}%`,
            }}
            title={`${label}：${storage?.storedBytes[kind] || 0} 字节`}
          />
        ))}
      </div>
      <div className="cloud-storage-details">
        <div className="cloud-storage-legend">
          {kinds.map(([kind, label]) => (
            <span key={kind} title={storage ? `${storage.storedBytes[kind]} 字节` : undefined}>
              <i className={`storage-${kind}`} />
              {label}
              {storage ? ` ${bytes(storage.storedBytes[kind])}` : ''}
            </span>
          ))}
        </div>
        <span>
          {storage ? (
            <>
              可用 {bytes(Math.max(0, capacity - used))} · 已用 {bytes(used)}
            </>
          ) : (
            '容量尚未读取'
          )}
        </span>
      </div>
    </section>
  );
}

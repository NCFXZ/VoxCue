import { useId, useRef, useState } from 'react';
import { t } from '../i18n';
import type { ImportPreviewEntry } from '../services/accountImport';
import { ChevronRight } from './icons';
import { Button } from './ui/button';
import { useHeightTransition } from './ui/useHeightTransition';

const groups = [
  ['profile', '个人信息'],
  ['interviews', '面试记录'],
  ['knowledge', '知识库'],
] as const;

function migrationItemName(entry: ImportPreviewEntry) {
  return entry.group === 'profile' ? t(entry.title) : entry.title;
}

export function AccountMigrationConflicts({ conflicts }: { conflicts: ImportPreviewEntry[] }) {
  const id = useId();
  return groups.map(([group, label]) => {
    const items = conflicts.filter((entry) => entry.group === group);
    if (!items.length) return null;
    const titleId = id + group;
    return (
      <section className="migration-conflict-group" key={group}>
        <h3 id={titleId}>{t(label)}</h3>
        <ul className="migration-conflict-list" aria-labelledby={titleId}>
          {items.map((entry) => <li key={entry.key}>{migrationItemName(entry)}</li>)}
        </ul>
      </section>
    );
  });
}

export function AccountMigrationSelection({
  entries,
  selected,
  onSelect,
  disabled,
}: {
  entries: ImportPreviewEntry[];
  selected: ReadonlySet<string>;
  onSelect(keys: string[], checked: boolean): void;
  disabled: boolean;
}) {
  const id = useId();
  const [expanded, setExpanded] = useState<Partial<Record<ImportPreviewEntry['group'], boolean>>>(
    {},
  );
  const list = useRef<HTMLDivElement>(null);
  const captureHeight = useHeightTransition(expanded, () => {
    const node = list.current;
    if (!node) return [];
    // The dialog's measured height includes its viewport cap.
    return [node.closest('dialog'), ...node.querySelectorAll<HTMLElement>('.migration-group-items')];
  });
  return (
    <div className="migration-groups" ref={list}>
      {groups.map(([group, label]) => {
        const items = entries.filter((entry) => entry.group === group);
        const count = items.filter((entry) => selected.has(entry.key)).length;
        const conflict = items.some((entry) => entry.conflict && selected.has(entry.key));
        const open = !!expanded[group];
        const groupId = id + group;
        return (
          <div className="migration-group" key={group}>
            <div className="selection-group-heading">
              <label className="selection-option">
                <input
                  type="checkbox"
                  checked={items.length > 0 && count === items.length}
                  disabled={disabled || !items.length}
                  ref={(node) => {
                    if (node) node.indeterminate = count > 0 && count < items.length;
                  }}
                  onChange={(event) =>
                    onSelect(
                      items.map((item) => item.key),
                      event.currentTarget.checked,
                    )
                  }
                />
                <span id={groupId + '-label'}>
                  {t(label)}
                  {conflict && <span className="migration-conflict"> {t('(部分冲突)')}</span>}
                </span>
              </label>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="selection-toggle"
                aria-label={t(open ? '收起{0}' : '展开{0}', [t(label)])}
                aria-expanded={open}
                aria-controls={groupId}
                disabled={disabled}
                onClick={() => {
                  captureHeight();
                  setExpanded((previous) => ({ ...previous, [group]: !previous[group] }));
                }}
              >
                <ChevronRight size={15} />
              </Button>
            </div>
            <div
              id={groupId}
              role="group"
              aria-labelledby={groupId + '-label'}
              className="migration-group-items"
              data-open={open}
              inert={!open}
              aria-hidden={!open}
            >
              <div>
                {items.map((item) => (
                  <label key={item.key} className="selection-option">
                    <input
                      type="checkbox"
                      checked={selected.has(item.key)}
                      disabled={disabled}
                      onChange={(event) => onSelect([item.key], event.currentTarget.checked)}
                    />
                    <span className={item.conflict ? 'migration-conflict' : undefined}>
                      {item.conflict && t('(冲突)') + ' '}
                      {migrationItemName(item)}
                    </span>
                  </label>
                ))}
                {!items.length && <p className="settings-hint">{t('此分类没有可迁移的资料。')}</p>}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

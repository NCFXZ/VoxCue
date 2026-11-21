import { useEffect, useId, useRef, useState } from 'react';
import { t } from '../i18n';
import { syncKindForKey, type SyncChoice, type SyncMark } from '../services/cloudSync';
import { fallbackSyncItemName, loadSyncItemNames } from '../services/syncItemNames';
import { useCloudAccount } from '../stores/cloudAccount';
import { useCloudSync } from '../stores/cloudSync';
import { useGeneralSettings } from '../stores/generalSettings';
import { Check, ChevronRight, CloudDone, Monitor, X } from './icons';
import { Button } from './ui/button';
import { Modal } from './ui/modal';
import { useHeightTransition } from './ui/useHeightTransition';
import { SyncBadge } from './SyncBadge';

const groups = [
  ['profile', '个人信息'],
  ['history', '面试记录'],
  ['knowledgebase', '知识库'],
] as const;
const versions = [['cloud', '云端'], ['local', '本地']] as const;

function VersionOptions({ name, mark, chosen, onChange }: {
  name: string;
  mark: SyncMark;
  chosen?: SyncChoice;
  onChange(side: SyncChoice['side']): void;
}) {
  const id = useId();
  const missing = mark.groupPresence?.cloud === false ? '云端没有这份资料，选择云端会移除本地副本。'
    : mark.groupPresence?.local === false ? '本地没有这份资料，选择本地会移除云端副本。' : undefined;
  return (
    <>
      <fieldset className="sync-version-choice" aria-label={name} aria-describedby={missing ? id + '-missing' : undefined}
        disabled={!mark.conflictVersion}>
        {versions.map(([side, label]) => (
          <label key={side} className="selection-option">
            <input type="radio" name={id} value={side}
              checked={chosen?.version === mark.conflictVersion && chosen?.side === side}
              onChange={() => onChange(side)} />
            {t(label)}
          </label>
        ))}
      </fieldset>
      {missing && <p id={id + '-missing'} className="settings-hint">{t(missing)}</p>}
    </>
  );
}

export function SyncProblemDialog({ mode, problems, busy, onClose }: {
  mode: 'conflict' | 'error';
  problems: [string, SyncMark][];
  busy: boolean;
  onClose(): void;
}) {
  const id = useId();
  const language = useGeneralSettings((state) => state.language);
  const owner = useCloudAccount((state) => state.state.user?.id);
  const keys = problems.map(([key]) => key).join('\n');
  const [names, setNames] = useState<Record<string, string>>({});
  const [chosen, setChosen] = useState<Record<string, SyncChoice>>({});
  const [failed, setFailed] = useState(false);
  const [collapsed, setCollapsed] = useState<Partial<Record<(typeof groups)[number][0], boolean>>>({});
  const content = useRef<HTMLDivElement>(null);
  const captureHeight = useHeightTransition(collapsed, () => content.current
    ? [content.current.closest('dialog'), ...content.current.querySelectorAll<HTMLElement>('.migration-group-items')]
    : []);
  useEffect(() => {
    let active = true;
    if (keys) void loadSyncItemNames(keys.split('\n')).then(value => {
      if (active) setNames(value);
    }).catch(() => {});
    return () => { active = false; };
  }, [keys, owner, language]);

  const selected = problems.flatMap(([key, mark]) => {
    const item = chosen[key];
    return item && item.version === mark.conflictVersion ? [item] : [];
  });
  const ready = !!owner && selected.length > 0;
  function chooseAll(side: SyncChoice['side']) {
    setChosen(Object.fromEntries(problems.flatMap(([key, mark]) =>
      mark.conflictVersion ? [[key, { key, side, version: mark.conflictVersion }]] : [])));
    setFailed(false);
  }
  function submit() {
    if (!owner || !selected.length) return;
    if (useCloudSync.getState().submitResolutions(owner, selected)) onClose();
    else setFailed(true);
  }
  const editing = mode === 'conflict';
  function itemName(key: string, mark: SyncMark) {
    const fallback = fallbackSyncItemName(key);
    const local = names[key];
    return local && local !== fallback ? local : mark.groupName || fallback;
  }
  return (
    <Modal title={t(editing ? '资料冲突' : '同步失败')} onClose={onClose}
      subtitle={editing ? '选择需要保留的资料。' : undefined}
      className="account-migration-dialog sync-problem-dialog" initialFocus="close" contentRef={content} wide={editing}
      overlayHeader={editing}
      action={editing && problems.length > 0 && <>
        <Button variant="outline" onClick={() => chooseAll('cloud')}>
          <CloudDone size={16} />{t('全选云端')}
        </Button>
        <Button variant="outline" onClick={() => chooseAll('local')}>
          <Monitor size={16} />{t('全选本地')}
        </Button>
      </>}
      footer={editing && <>
        <Button variant="outline" onClick={onClose}><X size={16} />{t('取消')}</Button>
        <Button disabled={!ready} onClick={submit}>
          <Check size={16} />
          {t('保留所选版本')}
        </Button>
      </>}>
      {groups.map(([kind, heading]) => {
        const items = problems.filter(([key]) => syncKindForKey(key) === kind);
        if (!items.length) return null;
        if (editing) {
          const open = !collapsed[kind];
          const groupId = id + kind;
          return (
            <section key={kind} className="sync-version-group">
              <h3>
                <button type="button" className="selection-toggle" aria-expanded={open} aria-controls={groupId}
                  aria-label={t(open ? '收起{0}' : '展开{0}', [t(heading)])} onClick={() => {
                    captureHeight();
                    setCollapsed(previous => ({ ...previous, [kind]: !previous[kind] }));
                  }}>
                  <span>{t(heading)}</span>
                  <ChevronRight size={16} />
                </button>
              </h3>
              <div id={groupId} className="migration-group-items" data-open={open} inert={!open} aria-hidden={!open}>
                {kind === 'knowledgebase' && <p className="settings-hint">{t('所选版本会替换整个知识库。')}</p>}
                <ul className="sync-version-list" aria-label={t(heading)}>
                  {items.map(([key, mark]) => {
                    const name = itemName(key, mark);
                    return (
                      <li key={key}>
                        <span className="sync-item-name">{name}</span>
                        <VersionOptions name={name} mark={mark} chosen={chosen[key]}
                          onChange={side => {
                            if (!mark.conflictVersion) return;
                            const choice = { key, side, version: mark.conflictVersion };
                            setChosen(previous => ({ ...previous, [key]: choice }));
                            setFailed(false);
                          }} />
                        {mark.error && <p className="settings-hint">{t(mark.error)}</p>}
                      </li>
                    );
                  })}
                </ul>
              </div>
            </section>
          );
        }
        return (
          <section key={kind} className="migration-conflict-group">
            <h3 id={id + kind}>{t(heading)}</h3>
            <ul className="sync-problem-list" aria-labelledby={id + kind}>
              {items.map(([key, mark]) => {
                const name = itemName(key, mark);
                return (
                  <li key={key}>
                    <div><span>{name}</span>
                      {mark.error && <p className="settings-hint">{t(mark.error)}</p>}
                    </div>
                    <SyncBadge itemKey={key} label={name} actionLabel="查看错误" />
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
      {failed && <p role="alert" className="danger-text">{t('未能提交所选版本，请核对后重试。')}</p>}
      {!problems.length && <p className="settings-hint" role="status">
        {t(busy ? '正在同步…' : '当前没有待处理的同步条目。')}
      </p>}
    </Modal>
  );
}

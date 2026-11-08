import { t } from '../i18n';
import { useCallback, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useCloudSync } from '../stores/cloudSync';
import { useCloudAccount } from '../stores/cloudAccount';
import {
  Cloud,
  CloudDone,
  CloudSync,
  CloudOff,
  CloudError,
  X,
  Refresh,
  Save,
  Download,
} from './icons';
import { Button } from './ui/button';
import { ConfirmDeleteButton } from './ui/confirm-delete-button';
import { animateDropdownEnter, animateDropdownExit } from './ui/dropdown-motion';
import type { SyncStatus } from '../services/cloudSync';

const labels: Record<SyncStatus, string> = {
  unsynced: '未同步',
  synced: '已同步',
  syncing: '正在同步',
  deleting: '正在删除',
  pausing: '正在取消同步',
  conflict: '同步冲突',
  paused: '已暂停同步',
  error: '同步失败',
};
export function SyncBadge({ itemKey, label = '此数据' }: { itemKey: string; label?: string }) {
  const mark = useCloudSync((s) => s.marks[itemKey]);
  const localMode = useCloudAccount((s) => s.state.localMode);
  const [acting, setActing] = useState(false);
  const status = mark?.status || 'unsynced';
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null),
    popup = useRef<HTMLDivElement | null>(null);
  const motion = useRef<{ enter?: () => void; exit?: () => void }>({});
  const mounted = useRef(true);
  const attach = useCallback((node: HTMLDivElement | null) => {
    if (!node && popup.current && mounted.current) {
      motion.current.exit?.();
      motion.current.exit = animateDropdownExit(popup.current, () => {
        motion.current.exit = undefined;
      });
    }
    motion.current.enter?.();
    motion.current.enter = undefined;
    popup.current = node;
  }, []);
  const id = useId();
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      motion.current.enter?.();
      motion.current.exit?.();
    };
  }, []);
  useLayoutEffect(() => {
    if (!open) return;
    motion.current.exit?.();
    let minimumWidth = 0;
    let focusFrame = 0;
    const update = () => {
      const a = trigger.current?.getBoundingClientRect(),
        positioner = popup.current?.parentElement,
        b = positioner?.getBoundingClientRect();
      if (!a || !positioner || !b) return;
      minimumWidth = Math.min(innerWidth - 16, Math.max(minimumWidth, b.width));
      popup.current!.style.minWidth = `${minimumWidth}px`;
      const above = a.bottom + 6 + b.height > innerHeight - 8;
      const side = above ? 'top' : 'bottom';
      if (popup.current!.dataset.side && popup.current!.dataset.side !== side) {
        motion.current.enter?.();
        motion.current.enter = undefined;
      }
      popup.current!.dataset.side = side;
      positioner.style.left = `${Math.max(8, Math.min(innerWidth - b.width - 8, a.right - b.width))}px`;
      positioner.style.top = `${above ? Math.max(8, a.top - b.height - 6) : a.bottom + 6}px`;
    };
    const outside = (e: PointerEvent) => {
      if (
        !trigger.current?.contains(e.target as Node) &&
        !popup.current?.contains(e.target as Node)
      )
        setOpen(false);
    };
    const keydown = (e: KeyboardEvent) => {
      if (e.key === 'Tab') {
        cancelAnimationFrame(focusFrame);
        focusFrame = requestAnimationFrame(() => {
          if (
            !trigger.current?.contains(document.activeElement) &&
            !popup.current?.contains(document.activeElement)
          )
            setOpen(false);
        });
        return;
      }
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      trigger.current?.focus();
    };
    update();
    if (popup.current) motion.current.enter = animateDropdownEnter(popup.current);
    const observer = new ResizeObserver(update);
    if (popup.current?.parentElement) observer.observe(popup.current.parentElement);
    const changes = new MutationObserver(update);
    if (popup.current?.firstElementChild)
      changes.observe(popup.current.firstElementChild, {
        attributes: true,
        attributeFilter: ['style'],
        childList: true,
        subtree: true,
      });
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    window.addEventListener('pointerdown', outside);
    window.addEventListener('keydown', keydown, true);
    return () => {
      cancelAnimationFrame(focusFrame);
      observer.disconnect();
      changes.disconnect();
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('pointerdown', outside);
      window.removeEventListener('keydown', keydown, true);
    };
  }, [open]);
  const perform = async (work: () => Promise<void>) => {
    setActing(true);
    try {
      await work();
    } finally {
      setActing(false);
    }
  };
  const Icon =
    status === 'synced'
      ? CloudDone
      : status === 'syncing' || status === 'deleting' || status === 'pausing'
        ? CloudSync
        : status === 'paused'
          ? CloudOff
          : status === 'error' || status === 'conflict'
            ? CloudError
            : Cloud;
  if (localMode) return null;
  return (
    <span className={`sync-indicator sync-${status}`} onClick={(e) => e.stopPropagation()}>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="action-icon-button sync-indicator-button"
        data-reveal-on-hover
        ref={trigger}
        aria-controls={id}
        aria-label={t('{0}：{1}', [t(label), t(labels[status])])}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon size={17} />
      </Button>
      {open &&
        createPortal(
          <div className="sync-popover-positioner" data-popup-positioner>
            <div
              id={id}
              ref={attach}
              className="dropdown-content sync-popover"
              role="group"
              onClick={(e) => e.stopPropagation()}
              aria-label={t('{0}同步状态', [t(label)])}
            >
              <div className="dropdown-scroll sync-popover-body">
                <strong>{t(labels[status])}</strong>
                {mark?.error && <span>{t(mark.error)}</span>}
                {status === 'unsynced' && (
                  <span>{t('在「设置 → VoxCue 账号」中开启对应同步。')}</span>
                )}
                <div className="sync-popover-actions">
                  {(mark?.cloudPresent || status === 'synced') &&
                    status !== 'syncing' &&
                    status !== 'deleting' &&
                    status !== 'pausing' && (
                      <ConfirmDeleteButton
                        target={t('{0}的云端副本', [t(label)])}
                        label={t('从云端删除')}
                        iconOnly={false}
                        fixedWidth
                        warning={
                          itemKey.startsWith('base:')
                            ? t('同时删除库内云端文件；本地数据不会被删除')
                            : t('本地数据保留，该项将暂停自动上传')
                        }
                        onConfirm={() => useCloudSync.getState().remove(itemKey)}
                      />
                    )}
                  {status === 'syncing' && (
                    <Button
                      variant="ghost"
                      onClick={() => void perform(() => useCloudSync.getState().pause(itemKey))}
                    >
                      <X size={17} />
                      {t('取消同步')}
                    </Button>
                  )}
                  {status === 'paused' && (
                    <Button
                      variant="ghost"
                      disabled={acting}
                      onClick={() => void perform(() => useCloudSync.getState().resume(itemKey))}
                    >
                      <CloudSync size={17} />
                      {t('自动同步')}
                    </Button>
                  )}
                  {status === 'conflict' && (
                    <>
                      <Button
                        variant="outline"
                        disabled={acting}
                        onClick={() =>
                          void perform(() => useCloudSync.getState().resolve(itemKey, 'local'))
                        }
                      >
                        <Save size={17} />
                        {t('保留本地版本')}
                      </Button>
                      <Button
                        variant="outline"
                        disabled={acting}
                        onClick={() =>
                          void perform(() => useCloudSync.getState().resolve(itemKey, 'cloud'))
                        }
                      >
                        <Download size={17} />
                        {t('使用云端版本')}
                      </Button>
                    </>
                  )}
                  {status === 'error' && (
                    <Button
                      variant="ghost"
                      disabled={acting}
                      onClick={() => void perform(() => useCloudSync.getState().refresh())}
                    >
                      <Refresh size={17} />
                      {t('重试同步')}
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </div>,
          trigger.current?.closest('dialog') || document.body,
        )}
    </span>
  );
}

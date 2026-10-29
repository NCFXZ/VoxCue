import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useCloudSync } from '../stores/cloudSync';
import { Cloud, CloudDone, CloudSync, CloudOff, CloudError, X } from './icons';
import { Button } from './ui/button';
import { ConfirmDeleteButton } from './ui/confirm-delete-button';
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
  const [acting, setActing] = useState(false);
  const status = mark?.status || 'unsynced';
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const trigger = useRef<HTMLButtonElement>(null),
    popup = useRef<HTMLDivElement>(null);
  const timeout = useRef<ReturnType<typeof setTimeout>>(undefined);
  const skipFocus = useRef(false);
  const id = useId();
  const enter = () => {
    clearTimeout(timeout.current);
    setOpen(true);
  };
  const leave = () => {
    clearTimeout(timeout.current);
    timeout.current = setTimeout(() => {
      if (
        !popup.current?.contains(document.activeElement) &&
        document.activeElement !== trigger.current
      )
        setOpen(false);
    }, 150);
  };
  useEffect(() => () => clearTimeout(timeout.current), []);
  useLayoutEffect(() => {
    if (!open) return;
    let minimumWidth = 0;
    const update = () => {
      const a = trigger.current?.getBoundingClientRect(),
        b = popup.current?.getBoundingClientRect();
      if (!a || !b) return;
      minimumWidth = Math.min(innerWidth - 16, Math.max(minimumWidth, b.width));
      popup.current!.style.minWidth = `${minimumWidth}px`;
      setPosition({
        left: Math.max(8, Math.min(innerWidth - b.width - 8, a.right - b.width)),
        top:
          a.bottom + 6 + b.height <= innerHeight - 8
            ? a.bottom + 6
            : Math.max(8, a.top - b.height - 6),
      });
    };
    const outside = (e: PointerEvent) => {
      if (
        !trigger.current?.contains(e.target as Node) &&
        !popup.current?.contains(e.target as Node)
      )
        setOpen(false);
    };
    update();
    const observer = new ResizeObserver(update);
    if (popup.current) observer.observe(popup.current);
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    window.addEventListener('pointerdown', outside);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('pointerdown', outside);
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
  return (
    <span
      className={`sync-indicator sync-${status}`}
      onClick={(e) => e.stopPropagation()}
      onPointerEnter={enter}
      onPointerLeave={leave}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget) && !popup.current?.contains(e.relatedTarget))
          setOpen(false);
      }}
    >
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="action-icon-button sync-indicator-button"
        data-reveal-on-hover
        ref={trigger}
        aria-controls={id}
        aria-label={`${label}：${labels[status]}`}
        aria-expanded={open}
        onFocus={() => {
          if (skipFocus.current) skipFocus.current = false;
          else setOpen(true);
        }}
        onClick={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            setOpen(false);
            e.stopPropagation();
          }
        }}
      >
        <Icon size={17} />
      </Button>
      {open &&
        createPortal(
          <div
            id={id}
            ref={popup}
            style={position}
            className="sync-popover"
            role="group"
            onClick={(e) => e.stopPropagation()}
            onPointerEnter={enter}
            onPointerLeave={leave}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                setOpen(false);
                skipFocus.current = true;
                trigger.current?.focus();
                e.stopPropagation();
              }
            }}
            aria-label={`${label}同步状态`}
          >
            <strong>{labels[status]}</strong>
            {mark?.error && <span>{mark.error}</span>}
            {(mark?.cloudPresent || status === 'synced') &&
              status !== 'syncing' &&
              status !== 'deleting' &&
              status !== 'pausing' && (
                <ConfirmDeleteButton
                  target={`${label}的云端副本`}
                  label="从云端删除"
                  iconOnly={false}
                  warning={
                    itemKey.startsWith('base:')
                      ? '同时删除库内云端文件；本地数据不会被删除'
                      : '本地数据保留，该项将暂停自动上传'
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
                取消同步
              </Button>
            )}
            {status === 'paused' && (
              <Button
                variant="ghost"
                disabled={acting}
                onClick={() => void perform(() => useCloudSync.getState().resume(itemKey))}
              >
                <CloudSync size={17} />
                自动同步
              </Button>
            )}
            {status === 'unsynced' && <span>在「设置 → VoxCue 账号」中开启对应同步。</span>}
            {status === 'conflict' && (
              <>
                <Button
                  variant="outline"
                  disabled={acting}
                  onClick={() =>
                    void perform(() => useCloudSync.getState().resolve(itemKey, 'local'))
                  }
                >
                  保留本地版本
                </Button>
                <Button
                  variant="outline"
                  disabled={acting}
                  onClick={() =>
                    void perform(() => useCloudSync.getState().resolve(itemKey, 'cloud'))
                  }
                >
                  使用云端版本
                </Button>
              </>
            )}
            {status === 'error' && (
              <Button
                variant="ghost"
                disabled={acting}
                onClick={() => void perform(() => useCloudSync.getState().refresh())}
              >
                重试同步
              </Button>
            )}
          </div>,
          trigger.current?.closest('dialog') || document.body,
        )}
    </span>
  );
}

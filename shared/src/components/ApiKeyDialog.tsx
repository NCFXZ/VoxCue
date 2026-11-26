import { useId, useLayoutEffect, useRef, useState } from 'react';
import {
  apiProviders,
  type ApiConnectionConfig,
  type ApiKeyField,
} from '../../electron/contracts/apiConnections';
import { InterviewReveal } from './InterviewReveal';
import { t } from '../i18n';
import { apiConnections } from '../services/apiConnections';
import { userError } from '../services/errors';
import { Button } from './ui/button';
import { Modal } from './ui/modal';
import { PasswordVisibilityButton } from './ui/password-visibility-button';
import { Loader, ShieldCheck, X } from './icons';

export function ApiKeyDialog({
  config,
  replacing = false,
  onFinish,
}: {
  config: ApiConnectionConfig;
  replacing?: boolean;
  onFinish(saved: boolean): void;
}) {
  const labelId = useId();
  const slot = useRef<HTMLDivElement>(null);
  const revealButton = useRef<HTMLButtonElement>(null);
  const active = useRef<string | undefined>(undefined);
  const cancelRequested = useRef(false);
  const finish = useRef(onFinish);
  finish.current = onFinish;
  const [phase, setPhase] = useState<'opening' | 'editing' | 'saving' | 'failed'>('opening');
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState('');
  const [visible, setVisible] = useState(false);

  useLayoutEffect(() => {
    const node = slot.current!;
    const dialog = node.closest('dialog')!;
    const requestId = crypto.randomUUID();
    let disposed = false;
    let entered = false;
    let frame = 0;
    let last: ApiKeyField | undefined;
    cancelRequested.current = false;
    setPhase('opening');
    setVisible(false);
    function retire() {
      if (active.current !== requestId) return;
      active.current = undefined;
      void apiConnections.control(requestId, { action: 'cancel' }).catch(() => {});
    }
    function fail(cause: unknown) {
      if (disposed) return;
      retire();
      if (cancelRequested.current) {
        finish.current(false);
        return;
      }
      setError(userError(cause, '无法打开 API 密钥输入窗口。'));
      setPhase('failed');
    }
    function layout() {
      frame = 0;
      if (disposed || !dialog.open || (last && active.current !== requestId)) return;
      const { left, top, width, height } = node.getBoundingClientRect();
      if (width <= 0 || height <= 0) return;
      const field = {
        x: Math.round(left),
        y: Math.round(top),
        width: Math.round(width),
        height: Math.round(height),
        dark: document.documentElement.classList.contains('dark'),
      };
      if (!last) {
        last = field;
        active.current = requestId;
        setPhase('editing');
        void apiConnections.configure(config, requestId, field).then((result) => {
          if (disposed || active.current !== requestId) return;
          active.current = undefined;
          if (typeof result === 'boolean') return finish.current(result);
          if (cancelRequested.current) return finish.current(false);
          setError(result.inputError);
          setAttempt((value) => value + 1);
        }, fail);
      } else if (
        field.x !== last.x ||
        field.y !== last.y ||
        field.width !== last.width ||
        field.height !== last.height ||
        field.dark !== last.dark
      ) {
        last = field;
        void apiConnections.control(requestId, { action: 'layout', field }).catch(fail);
      }
    }
    function schedule() {
      if (entered && !disposed && !frame) frame = requestAnimationFrame(layout);
    }
    const resize = new ResizeObserver(schedule);
    resize.observe(node);
    resize.observe(dialog);
    const theme = new MutationObserver(schedule);
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', schedule, true);
    const stopTab = apiConnections.onTab((id, backwards) => {
      if (id !== requestId || active.current !== requestId) return;
      const next = backwards
        ? dialog.querySelector<HTMLButtonElement>('.dialog-close-button')
        : revealButton.current;
      next?.focus({ preventScroll: true });
    });
    // The native editor is outside Chromium's opacity layer. Let the empty field
    // fade in with the dialog before placing the editor over its final surface.
    const fades = dialog.getAnimations().filter(animation =>
      animation instanceof CSSAnimation && animation.animationName === 'modal-fade-in');
    void Promise.allSettled(fades.map(animation => animation.finished)).then(() => {
      entered = true;
      schedule();
    });
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      resize.disconnect();
      theme.disconnect();
      window.removeEventListener('resize', schedule);
      window.removeEventListener('scroll', schedule, true);
      stopTab();
      retire();
    };
  }, [config, attempt]);

  function close() {
    if (!active.current) return finish.current(false);
    if (cancelRequested.current) return;
    cancelRequested.current = true;
    void apiConnections
      .control(active.current, { action: 'cancel' })
      .catch(() => finish.current(false));
  }
  function submit() {
    const requestId = active.current;
    if (!requestId || phase !== 'editing') return;
    setPhase('saving');
    setError('');
    void apiConnections.control(requestId, { action: 'submit' }).catch((cause) => {
      if (active.current !== requestId) return;
      setPhase('editing');
      setError(userError(cause, '无法验证 API 密钥。'));
    });
  }
  function focusField() {
    if (phase === 'failed') setAttempt((value) => value + 1);
    else if (active.current)
      void apiConnections.control(active.current, { action: 'focus' }).catch(() => {});
  }
  function toggleVisibility(fromPointer: boolean) {
    const id = active.current;
    if (!id || phase !== 'editing') return;
    const next = !visible;
    setVisible(next);
    void apiConnections.control(id, { action: 'visibility', visible: next }).then(() => {
      // A pointer click on the eye should allow typing to continue in the native field.
      // Keyboard activation leaves focus on the button for Tab and screen-reader navigation.
      if (fromPointer && active.current === id && document.activeElement === revealButton.current)
        focusField();
    }, (cause) => {
      if (active.current !== id) return;
      setVisible(!next);
      setError(userError(cause, '连接操作失败，请重试。'));
    });
  }
  const SubmitIcon = phase === 'saving' ? Loader : ShieldCheck;
  return (
    <Modal
      title={t(replacing ? '更换 API 密钥' : '添加 API 密钥')}
      className="account-delete-dialog api-key-dialog"
      onClose={close}
      footer={
        <>
          <Button variant="outline" onClick={close}>
            <X size={16} />
            {t('取消')}
          </Button>
          <Button disabled={phase !== 'editing'} onClick={submit}>
            <SubmitIcon size={16} />
            {t(phase === 'saving' ? '正在验证…' : '验证并保存')}
          </Button>
        </>
      }
    >
      <div className="api-key-label" id={labelId}>
        {t('{0} API 密钥', [t(apiProviders[config.provider].name).replace(/ API$/, '')])}
      </div>
      <div className="api-key-input-frame" onPointerDown={(event) => {
        if (event.button !== 0) return;
        if (event.target === event.currentTarget ||
            (event.target === slot.current && document.activeElement === slot.current)) {
          event.preventDefault();
          focusField();
        }
      }}>
        <div
          ref={slot}
          data-api-key-field=""
          className="api-key-input-slot"
          role="group"
          aria-labelledby={labelId}
          aria-describedby={error ? labelId + '-error' : undefined}
          tabIndex={phase === 'editing' || phase === 'failed' ? 0 : -1}
          onFocus={(event) => {
            if (event.target === slot.current) focusField();
          }}
        />
        <PasswordVisibilityButton
          ref={revealButton}
          visible={visible}
          label={t(visible ? '隐藏密钥' : '显示密钥')}
          disabled={phase !== 'editing'}
          onClick={(event) => toggleVisibility(event.detail > 0)}
        />
      </div>
      <InterviewReveal>
        {error ? (
          <p id={labelId + '-error'} className="danger-text" role="alert">
            {t(error)}
          </p>
        ) : null}
      </InterviewReveal>
    </Modal>
  );
}

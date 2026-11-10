import { t } from '../i18n';
import { interviewAlwaysDark } from './ui/appearance-control';
import { InterviewImages } from './InterviewImages';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { flushSync } from 'react-dom';
import type { InterviewCanvasLayout } from '../../electron/contracts/desktop';
import {
  ArrowUp,
  ChevronDown,
  ShieldCheck,
  ShieldOff,
  Square,
  Expand,
  MessageSquare,
  Volume2,
  DragGrip,
  Copy,
  Check,
  Screenshot,
  Loader,
  X,
  Refresh,
  AudioLines,
  Sparkles,
  Settings,
  Keyboard,
} from './icons';
import { Button } from './ui/button';
import { useInterview } from '../stores/interview';
import { useComponents } from '../stores/components';
import { useHistory } from '../stores/history';
import { AppLogo } from './AppLogo';
import { useFollowScroll } from './useFollowScroll';
import { FollowLatestButton } from './FollowLatestButton';
import { MarkdownContent } from './MarkdownContent';
import { ResponseProgress } from './ResponseProgress';
import { InterviewAudioRecovery } from './InterviewAudioRecovery';
import {
  RemoteConnectionDialogs,
  RemoteConnectionIndicator,
  RemoteConnectionRecovery,
} from './RemoteConnection';
import { InterviewSettingsPanel } from './InterviewSettingsPanel';
import { InterviewReadiness } from './InterviewReadiness';
import { InterviewChromeBase } from './InterviewChromeBase';
import { interviewLayout } from '../../electron/contracts/interviewLayout';
import { ProviderIdentity } from './ProviderIdentity';
import { InterviewAnswerFailure, InterviewAnswerStatus } from './InterviewAnswerStatus';
import { providerInfo } from '../services/providers';
import { useInterviewWindowDrag } from './useInterviewWindowDrag';
import { useInterviewPanelMotion } from './useInterviewPanelMotion';
import { useInterviewRendererReady } from './useInterviewRendererReady';
import { useInterviewFontSize } from '../interviewTypography';
import { useTextareaSize } from './useTextareaSize';
import { useShortcuts } from '../stores/shortcuts';
import { matchesShortcut, displayShortcut } from '../../electron/contracts/shortcuts';
import { useChatConnection } from '../stores/chatConnection';
import { accountUsageSummary, isAccountUsageLow } from '../services/accountUsageSummary';
export function FloatingInterview() {
  useEffect(() => useComponents.getState().connect(), []);
  const fontSize = useInterviewFontSize();
  const state = useInterview();
  const connection = useChatConnection();
  const usageEnabled = state.aiEnabled && state.status !== 'ended';
  const lowUsage = usageEnabled && !connection.loadingUsage && isAccountUsageLow(connection.usage);
  useEffect(() => {
    if (usageEnabled) return useChatConnection.getState().watchUsage('interview');
  }, [usageEnabled]);
  useEffect(() => {
    if (usageEnabled && !state.generating && state.answers.length)
      void useChatConnection.getState().refreshUsage('interview');
  }, [usageEnabled, state.generating, state.answers.length]);
  const screenshotExpanded = state.capturingScreenshot || state.screenshots.length > 0;
  const macScreenshotShortcut = window.desktop?.platform === 'macos';
  const shortcutSettings = useShortcuts((state) => state.state);
  const screenshotShortcut = shortcutSettings.bindings.screenshot;
  const screenshotKeyLabel = screenshotShortcut ? displayShortcut(screenshotShortcut) : '';
  const provider = providerInfo(state.answers.at(-1)?.provider);
  const failedAnswer = state.answers.at(-1)?.status === 'failed' ? state.answers.at(-1) : undefined;
  const saveError = useHistory((s) => s.error);
  const [protectedWindow, setProtected] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const noticeError =
    error || saveError || (state.error !== failedAnswer?.error ? state.error : null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsChanging = useRef(false);
  const settingsCanvasRequested = useRef(false);
  const remoteCanvasRequested = useRef(false);
  const remoteCanvasRevision = useRef(0);
  const settingsCanvasQueue = useRef<Promise<void>>(Promise.resolve());
  const windowDrag = useInterviewWindowDrag(() => setError('无法移动面试窗口。'));
  const [showTranscript, setShowTranscript] = useState(true);
  const [collapsed, setCollapsed] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [shortcutsBusy, setShortcutsBusy] = useState(false);
  const shortcutsChanging = useRef(false);
  const shortcutsEvents = useRef(0);
  const shortcutsRequest = useRef(0);
  const [canvasLayout, setCanvasLayout] = useState<InterviewCanvasLayout>();
  const layoutRevision = useRef(0);
  const [windowReady, setWindowReady] = useState(false);
  const [rendererRevision, setRendererRevision] = useState<number>();
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [ending, setEnding] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [resizing, setResizing] = useState(false);
  const transcriptScroll = useFollowScroll(state.transcripts);
  const answerScroll = useFollowScroll(state.answers);
  const resizeReady = useRef<Promise<void>>(Promise.resolve());
  const resizeFrame = useRef(0);
  const resizeMove = useRef<Promise<void>>(Promise.resolve());
  const resizeInFlight = useRef(false);
  const resizeDirty = useRef(false);
  const dragging = useRef(false);
  const resizePointer = useRef<{ target: HTMLButtonElement; id: number } | null>(null);
  const currentInput = state.inputDraft ?? state.draftQuestion;
  const inputRef = useTextareaSize(currentInput, 1, 6);
  const shell = useRef<HTMLDivElement>(null);
  useInterviewRendererReady(rendererRevision, shell, setError);
  const panelMotion = useInterviewPanelMotion({
    shell,
    collapsed,
    transcriptVisible: showTranscript,
    setCollapsed,
    setTranscriptVisible: setShowTranscript,
    canStart: () =>
      !settingsChanging.current && !dragging.current && !resizing && !windowDrag.active.current,
    onError: setError,
  });
  useEffect(
    () =>
      window.desktop?.onInterviewShortcut((command) => {
        if (command === 'toggle-microphone') {
          void useInterview.getState().toggleMicrophone();
          return;
        }
        if (command === 'toggle-system-audio') {
          void useInterview.getState().toggleSystemAudio();
          return;
        }
        if (command === 'submit-input') {
          if (windowReady && !ending) useInterview.getState().submitInput();
          return;
        }
        if (command === 'screenshot') {
          const current = useInterview.getState();
          if (windowReady && !ending && !current.inputDraftComposing && !useShortcuts.getState().state.capturing)
            void current.captureScreenshot();
          return;
        }
        if (
          !windowReady ||
          ending ||
          settingsChanging.current ||
          document.querySelector('dialog[open]')
        )
          return;
        if (command === 'toggle-panels') void panelMotion.toggleCollapsed();
        else if (command === 'toggle-transcript') void panelMotion.toggleTranscript();
      }),
    [windowReady, ending, collapsed, showTranscript, resizing],
  );
  useEffect(() => {
    let active = true;
    const revision = shortcutsEvents.current;
    const unsubscribe = window.desktop?.onInterviewShortcutsOpen((open) => {
      if (!active) return;
      ++shortcutsEvents.current;
      setShortcutsOpen(open);
    });
    void window.desktop
      ?.interviewShortcutsState()
      .then((value) => {
        if (active && revision === shortcutsEvents.current) setShortcutsOpen(value.open);
      })
      .catch(() => {});
    return () => {
      active = false;
      ++shortcutsRequest.current;
      unsubscribe?.();
    };
  }, []);
  useEffect(() => {
    if (!shortcutsOpen) return;
    const closeHelp = (event: KeyboardEvent) => {
      if (
        event.key !== 'Escape' ||
        event.defaultPrevented ||
        event.isComposing ||
        document.querySelector('dialog[open]')
      )
        return;
      event.preventDefault();
      void changeShortcuts(false);
    };
    window.addEventListener('keydown', closeHelp);
    return () => window.removeEventListener('keydown', closeHelp);
  }, [shortcutsOpen]);
  async function changeShortcuts(open: boolean) {
    if (shortcutsChanging.current) return;
    shortcutsChanging.current = true;
    setShortcutsBusy(true);
    const request = ++shortcutsRequest.current,
      revision = shortcutsEvents.current;
    try {
      const actual = await window.desktop!.setInterviewShortcutsOpen(open);
      if (request === shortcutsRequest.current && revision === shortcutsEvents.current)
        setShortcutsOpen(actual);
    } catch {
      if (request === shortcutsRequest.current) setError('窗口切换失败，请重试。');
    } finally {
      if (request === shortcutsRequest.current) {
        shortcutsChanging.current = false;
        setShortcutsBusy(false);
      }
    }
  }
  useLayoutEffect(() => {
    transcriptScroll.syncLayout();
    answerScroll.syncLayout();
  }, [collapsed, showTranscript]);
  useEffect(() => {
    const desktop = window.desktop;
    if (!desktop?.presentation?.interviewMousePassthrough) return;
    const surfaces =
      '.floating-toolbar, .floating-panel, .floating-resize, .floating-notices > div, dialog[open]';
    let disposed = false;
    let ignored: boolean | undefined;
    let pointer: { x: number; y: number; buttons: number } | undefined;
    const apply = (ignore: boolean) => {
      if (ignore === ignored) return;
      ignored = ignore;
      desktop.setInterviewMousePassthrough(ignore);
    };
    const refresh = () => {
      // A reserved native canvas includes transparent space beyond the content.
      // Only the visible canvas owns the modal's outside-click dismiss target.
      if (!disposed && document.querySelector('dialog[open]')) {
        if (pointer?.buttons) {
          apply(false);
          return;
        }
        const viewport = shell.current?.parentElement;
        const width =
          viewport && parseFloat(getComputedStyle(viewport).getPropertyValue('--interview-width'));
        const left = width ? (innerWidth - width) / 2 : 0;
        const x = pointer ? pointer.x - window.screenX : left;
        const y = pointer ? pointer.y - window.screenY : 0;
        apply(
          x < left || x > innerWidth - left || y < 0 || y > (viewport?.clientHeight ?? innerHeight),
        );
        return;
      }
      if (disposed || !pointer || pointer.buttons || dragging.current || windowDrag.active.current)
        return;
      const target = document.elementFromPoint(
        pointer.x - window.screenX,
        pointer.y - window.screenY,
      );
      apply(!target?.closest(surfaces));
    };
    const move = (event: MouseEvent) => {
      // Forwarded events can report screen coordinates relative to the view.
      // Reconstruct the screen point from the current window and viewport point.
      pointer = {
        x: window.screenX + event.clientX,
        y: window.screenY + event.clientY,
        buttons: event.buttons,
      };
      refresh();
    };
    const release = (event: MouseEvent) => {
      move(event);
      // Resize's mouseup listener releases its drag lock later in this event.
      queueMicrotask(refresh);
    };
    const leave = (event: MouseEvent) => {
      if (event.relatedTarget || event.buttons || dragging.current || windowDrag.active.current)
        return;
      // Disabling native forwarding can queue a leave with older coordinates.
      // Keep the latest move/release point; a leave must not overwrite it and
      // make a control click-through again. Outside this window, Windows/macOS
      // already route input to the window under the cursor.
      refresh();
    };
    // Forwarded mouse moves keep the visible controls reachable while blank
    // canvas areas pass clicks through. Never switch in the middle of a drag.
    apply(true);
    window.addEventListener('mousemove', move, true);
    window.addEventListener('mousedown', move, true);
    window.addEventListener('mouseup', release, true);
    window.addEventListener('mouseout', leave, true);
    window.addEventListener('resize', refresh);
    window.addEventListener('interview-window-drag-end', refresh);
    const observer = new ResizeObserver(refresh);
    const dialogs = new MutationObserver(refresh);
    dialogs.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['open'],
    });
    document
      .querySelectorAll('.floating-toolbar, .floating-panels, .floating-notices')
      .forEach((element) => observer.observe(element));
    return () => {
      disposed = true;
      observer.disconnect();
      dialogs.disconnect();
      window.removeEventListener('mousemove', move, true);
      window.removeEventListener('mousedown', move, true);
      window.removeEventListener('mouseup', release, true);
      window.removeEventListener('mouseout', leave, true);
      window.removeEventListener('resize', refresh);
      window.removeEventListener('interview-window-drag-end', refresh);
      desktop.setInterviewMousePassthrough(true);
    };
  }, []);
  const latestQuestion =
    state.draftQuestion ||
    [...state.transcripts]
      .reverse()
      .find(
        (transcript) =>
          transcript.reason !== 'discontinuity' &&
          (state.inputMode === 'transcription'
            ? transcript.source === 'microphone'
            : transcript.source === 'system' || (!transcript.source && state.mode === 'mock')),
      )?.text ||
    '';
  useEffect(() => {
    if (!confirmEnd || ending) return;
    const timer = setTimeout(() => setConfirmEnd(false), 3000);
    return () => clearTimeout(timer);
  }, [confirmEnd, ending]);
  useEffect(() => {
    // Native window resizing can release pointer capture before pointerup.
    const move = (event: PointerEvent) => {
      if (!dragging.current) return;
      if (!(event.buttons & 1)) {
        finishResize();
        return;
      }
      queueResize();
    };
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerup', finishResize, true);
    window.addEventListener('mouseup', finishResize, true);
    window.addEventListener('pointercancel', finishResize, true);
    return () => {
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', finishResize, true);
      window.removeEventListener('mouseup', finishResize, true);
      window.removeEventListener('pointercancel', finishResize, true);
    };
  }, []);
  useEffect(
    () => () => {
      cancelAnimationFrame(resizeFrame.current);
      if (dragging.current) void window.desktop?.resizeInterview({ phase: 'end' }).catch(() => {});
    },
    [],
  );
  useEffect(
    () => window.desktop?.onInterviewTitle((event) => useHistory.getState().applyTitle(event)),
    [],
  );
  useEffect(() => {
    let active = true;
    const applyLayout = (layout: InterviewCanvasLayout | undefined) => {
      if (!active || !layout || layout.revision < layoutRevision.current) return;
      layoutRevision.current = layout.revision;
      setCanvasLayout(layout);
    };
    const unsubscribeLayout = window.desktop?.onInterviewLayout(applyLayout);
    void window.desktop
      ?.interviewState()
      .then((value) => {
        if (!active) return;
        setProtected(value.protected);
        setCollapsed(value.collapsed);
        setShowTranscript(value.transcriptVisible);
        applyLayout(value.layout);
        setWindowReady(true);
        setRendererRevision(value.rendererRevision);
        useInterview.getState().initialize(value.configuration, value.inputState);
      })
      .catch(() => {
        setWindowReady(true);
        setError('无法读取已确认的面试设置，请结束面试后重试。');
      });
    const media = matchMedia('(prefers-color-scheme: dark)');
    const theme = () => {
      const value = localStorage.getItem('copilot-theme');
      document.documentElement.classList.toggle(
        'dark',
        interviewAlwaysDark || value === 'dark' || (value !== 'light' && media.matches),
      );
    };
    theme();
    media.addEventListener('change', theme);
    window.addEventListener('storage', theme);
    const archive = () => {
      const current = useInterview.getState();
      if (current.sessionId && current.status !== 'ended') {
        // beforeunload cannot await IPC. Save the received text synchronously;
        // explicit End still awaits the native tail flush before saving.
        if (current.mode === 'local') current.archive('interrupted');
        void current.end();
      }
    };
    window.addEventListener('beforeunload', archive);
    const unsubscribeEnd = window.desktop?.onInterviewEndRequested(() => setConfirmEnd(true));
    return () => {
      active = false;
      media.removeEventListener('change', theme);
      window.removeEventListener('storage', theme);
      window.removeEventListener('beforeunload', archive);
      unsubscribeEnd?.();
      unsubscribeLayout?.();
    };
  }, []);
  async function toggleCapture() {
    setBusy(true);
    setError(null);
    try {
      setProtected(await window.desktop!.allowCapture(protectedWindow));
    } catch {
      setError('截图权限切换失败，状态未更改。');
    } finally {
      setBusy(false);
    }
  }
  function syncSettingsCanvas() {
    const next = settingsCanvasQueue.current.catch(() => {}).then(() =>
      window.desktop!.setInterviewSettingsOpen(
        settingsCanvasRequested.current || remoteCanvasRequested.current,
      ),
    );
    settingsCanvasQueue.current = next;
    return next;
  }
  const changeRemoteCanvas = useCallback(async (open: boolean) => {
    const revision = ++remoteCanvasRevision.current;
    if (!open) {
      const exit = document.querySelector('.remote-connection-dialog[data-modal-exit]');
      await Promise.all(exit?.getAnimations().map((animation) => animation.finished.catch(() => {})) ?? []);
    }
    if (revision !== remoteCanvasRevision.current) return;
    if (remoteCanvasRequested.current === open) return settingsCanvasQueue.current;
    remoteCanvasRequested.current = open;
    try {
      await syncSettingsCanvas();
    } catch (error) {
      setError('窗口切换失败，请重试。');
      throw error;
    }
  }, []);
  async function changeSettings(open: boolean) {
    if (
      settingsChanging.current ||
      panelMotion.busy.current ||
      dragging.current ||
      resizing ||
      windowDrag.active.current
    )
      return;
    settingsChanging.current = true;
    const previous = settingsCanvasRequested.current;
    try {
      if (!open) {
        flushSync(() => setSettingsOpen(false));
        // Keep the existing exit animation on the temporary expanded canvas.
        const exit = document.querySelector('.interview-settings-dialog[data-modal-exit]');
        await Promise.all(exit?.getAnimations().map((a) => a.finished.catch(() => {})) ?? []);
      }
      settingsCanvasRequested.current = open;
      await syncSettingsCanvas();
      if (open) setSettingsOpen(true);
    } catch {
      settingsCanvasRequested.current = previous;
      if (!open) setSettingsOpen(true);
      setError('窗口切换失败，请重试。');
    } finally {
      settingsChanging.current = false;
    }
  }
  const close = async () => {
    if (ending) return;
    setEnding(true);
    try {
      await state.end();
      if (!useHistory.getState().error) window.desktop?.confirmInterviewEnd();
    } finally {
      setEnding(false);
    }
  };
  const submit = () => {
    useInterview.getState().submitInput({
      expectedRevision: state.inputDraftRevision,
      fallbackQuestion: latestQuestion,
    });
  };
  // Keep only the latest pointer intent and one native resize in flight.
  function queueResize() {
    resizeDirty.current = true;
    if (resizeFrame.current || resizeInFlight.current || !dragging.current) return;
    resizeFrame.current = requestAnimationFrame(() => {
      resizeFrame.current = 0;
      resizeDirty.current = false;
      resizeInFlight.current = true;
      resizeMove.current = resizeReady.current
        .then(() => window.desktop!.resizeInterview({ phase: 'move' }))
        .catch(() => setError('无法调整窗口尺寸。'))
        .finally(() => {
          resizeInFlight.current = false;
          const pointer = resizePointer.current;
          if (dragging.current && pointer && !pointer.target.hasPointerCapture(pointer.id)) {
            try {
              pointer.target.setPointerCapture(pointer.id);
            } catch {
              /* The pointer may already be up. */
            }
          }
          if (resizeDirty.current && dragging.current) queueResize();
        });
    });
  }
  function finishResize() {
    if (!dragging.current) return;
    dragging.current = false;
    resizePointer.current = null;
    cancelAnimationFrame(resizeFrame.current);
    resizeFrame.current = 0;
    resizeDirty.current = false;
    void resizeReady.current
      .then(() => resizeMove.current)
      .then(async () => {
        await window.desktop!.resizeInterview({ phase: 'move' });
        await window.desktop!.resizeInterview({ phase: 'end' });
      })
      .catch(() => setError('无法调整窗口尺寸。'))
      .finally(() => setResizing(false));
  }
  const resizeHandle = (edge: 'left' | 'right') => (
    <button
      type="button"
      className={`floating-resize resize-${edge}`}
      aria-label={edge === 'left' ? t('拖动左下角调整尺寸') : t('拖动右下角调整尺寸')}
      aria-describedby="resize-keyboard-hint"
      onKeyDown={(event) => {
        if (panelMotion.busy.current || settingsChanging.current) return;
        if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', '+', '-'].includes(event.key))
          return;
        event.preventDefault();
        void window
          .desktop!.resizeInterview(['ArrowUp', 'ArrowRight', '+'].includes(event.key) ? 1 : -1)
          .catch(() => setError('无法调整窗口尺寸。'));
      }}
      onPointerDown={(event) => {
        if (event.button !== 0 || panelMotion.busy.current || settingsChanging.current) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        resizePointer.current = { target: event.currentTarget, id: event.pointerId };
        dragging.current = true;
        setResizing(true);
        resizeReady.current = window
          .desktop!.resizeInterview({ phase: 'start', edge })
          .catch(() => setError('无法调整窗口尺寸。'));
      }}
      onPointerUp={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          event.currentTarget.releasePointerCapture(event.pointerId);
        finishResize();
      }}
      onPointerCancel={() => {
        finishResize();
      }}
    >
      <Expand size={17} />
    </button>
  );
  return (
    <div
      className="floating-viewport"
      style={
        {
          visibility: windowReady ? undefined : 'hidden',
          ...(canvasLayout && {
            '--interview-width': `${canvasLayout.width}px`,
            '--interview-height': `${canvasLayout.height}px`,
          }),
        } as CSSProperties
      }
    >
      <div
        ref={shell}
        data-panel-motion={panelMotion.motion ?? undefined}
        style={
          {
            '--panel-height': `max(0px, calc(var(--interview-height, 100dvh) - ${interviewLayout.chromeHeight}px))`,
            '--interview-font-size': `${fontSize}px`,
            '--transcript-width': `calc(var(--panel-height) * ${interviewLayout.transcriptWidth / interviewLayout.panelHeight})`,
            '--answer-width': `calc(var(--panel-height) * ${interviewLayout.answerWidth / interviewLayout.panelHeight})`,
          } as CSSProperties
        }
        className={`floating-shell ${collapsed ? 'is-collapsed' : ''} ${resizing ? 'is-resizing' : ''}`}
      >
        <header className="floating-toolbar">
          <button
            type="button"
            className="floating-brand floating-collapse"
            aria-label={collapsed ? t('展开面试窗口') : t('收起面试窗口')}
            aria-expanded={!collapsed}
            aria-disabled={!!panelMotion.motion}
            onClick={() => void panelMotion.toggleCollapsed()}
          >
            <span className="floating-collapse-chevron">
              <ChevronDown size={16} />
            </span>
            <AppLogo size={17} />
            <strong>VoxCue</strong>
          </button>
          <div className="floating-controls">
            <Button
              variant="ghost"
              size="icon"
              aria-label={t('面试设置')}
              onClick={() => void changeSettings(true)}
            >
              <Settings size={19} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              disabled={busy}
              aria-pressed={protectedWindow}
              aria-label={protectedWindow ? t('关闭截图保护') : t('开启截图保护')}
              onClick={() => {
                void toggleCapture();
              }}
            >
              {protectedWindow ? <ShieldCheck size={18} /> : <ShieldOff size={18} />}
            </Button>
            <Button
              className={`floating-end ${confirmEnd ? 'is-confirming' : ''}`}
              disabled={ending}
              variant={confirmEnd ? 'destructive' : 'dangerGhost'}
              size={confirmEnd ? 'default' : 'icon'}
              aria-label={confirmEnd ? t('确认结束面试') : t('结束面试')}
              onClick={confirmEnd ? close : () => setConfirmEnd(true)}
            >
              <span className="button-morph-idle" aria-hidden="true">
                <Square size={16} />
              </span>
              <span className="button-morph-expanded" aria-hidden="true">
                <Square size={16} />
                <span>{t('确认结束')}</span>
              </span>
            </Button>
            <div
              className="floating-drag-handle"
              aria-label={t('拖动面试窗口')}
              onPointerDown={(event) => {
                if (!panelMotion.busy.current && !settingsChanging.current)
                  windowDrag.onPointerDown(event);
              }}
            >
              <DragGrip size={20} />
            </div>
          </div>
        </header>
        <div
          hidden={collapsed}
          className={`floating-panels ${showTranscript ? '' : 'answer-only'}`}
        >
          <section className="floating-panel floating-transcript" hidden={!showTranscript}>
            <InterviewChromeBase />
            <header>
              <div className="floating-transcript-title">
                <h2>
                  <Volume2 size={16} />
                  {t('转写')}
                </h2>
              </div>
              <InterviewReadiness device={<RemoteConnectionIndicator />} />
            </header>
            <div className="floating-audio-recovery">
              <InterviewAudioRecovery onSettings={() => void changeSettings(true)} />
              <RemoteConnectionRecovery onSettings={() => void changeSettings(true)} />
            </div>
            <div
              className="floating-scroll"
              {...transcriptScroll.scrollProps}
              tabIndex={0}
              aria-label={t('面试转写')}
            >
              {!state.transcripts.length && (
                <div className="floating-empty">
                  {state.inputMode === 'transcription' ? (
                    <AudioLines size={26} />
                  ) : (
                    <Volume2 size={26} />
                  )}
                  <p>
                    {t(
                      state.inputMode === 'transcription'
                        ? '等待麦克风语音输入…'
                        : '等待面试官或面试者讲话…',
                    )}
                  </p>
                  {state.inputMode !== 'transcription' && (
                    <span>{t('面试官在左侧，面试者在右侧')}</span>
                  )}
                </div>
              )}
              {state.transcripts.map((transcript) => (
                <article
                  className={`transcript-item ${transcript.source === 'microphone' && state.inputMode !== 'transcription' ? 'interviewee' : 'interviewer'}`}
                  key={transcript.id}
                >
                  <div className="transcript-meta">
                    <strong>
                      {transcript.source
                        ? transcript.source === 'system'
                          ? t('面试官')
                          : t(state.inputMode === 'transcription' ? '麦克风' : '面试者')
                        : t('面试官')}
                    </strong>
                    <time>{transcript.time}</time>
                  </div>
                  <p>
                    {transcript.text}
                    {!transcript.final && state.status === 'running' && (
                      <span className="typing-caret" />
                    )}
                  </p>
                  {transcript.reason === 'discontinuity' && (
                    <small className="transcript-gap">{t('音频间断，片段可能不完整')}</small>
                  )}
                </article>
              ))}
            </div>
            {!transcriptScroll.following && (
              <FollowLatestButton
                label={transcriptScroll.hasNew ? t('有新转写 · 返回最新') : t('返回最新转写')}
                onClick={transcriptScroll.scrollToLatest}
              />
            )}
          </section>
          <section className="floating-panel floating-answer">
            <InterviewChromeBase />
            <header>
              <h2>
                <MessageSquare size={17} />
                {t('回答')}
              </h2>
              <div className="floating-header-actions">
                <Button
                  variant="ghost"
                  className="floating-shortcuts-toggle"
                  aria-pressed={shortcutsOpen}
                  aria-expanded={shortcutsOpen}
                  aria-disabled={shortcutsBusy}
                  onClick={() => void changeShortcuts(!shortcutsOpen)}
                >
                  <span className="toggle-dot" />
                  <Keyboard size={14} />
                  {t('快捷键')}
                </Button>
                <Button
                  variant="ghost"
                  className="floating-toggle"
                  aria-label={t('转写面板')}
                  aria-pressed={showTranscript}
                  aria-disabled={!!panelMotion.motion}
                  onClick={() => void panelMotion.toggleTranscript()}
                >
                  <span className="toggle-dot" />
                  <AudioLines size={14} />
                  {t('转写')}
                </Button>
              </div>
            </header>
            <div className="floating-audio-recovery">
              {!showTranscript && (
                <>
                  <InterviewAudioRecovery onSettings={() => void changeSettings(true)} />
                  <RemoteConnectionRecovery onSettings={() => void changeSettings(true)} />
                </>
              )}
            </div>
            <div
              className="floating-scroll"
              {...answerScroll.scrollProps}
              tabIndex={0}
              aria-label={t('面试回答')}
            >
              {!state.answers.length && (
                <div className="floating-empty answer-empty">
                  <p>
                    {state.aiEnabled
                      ? t('{0}回答已启用。', [provider.name])
                      : t('请先连接模型服务。')}
                  </p>
                  <span>
                    {t('直接发送下方实时转写，或输入新的问题。')}
                    <br />
                    {state.aiEnabled
                      ? t('回答会结合本场问题、追问和你的实际回答。仅发送必要文字与相关资料片段。')
                      : t('请连接模型服务并选择回答模型。')}
                  </span>
                </div>
              )}
              {state.answers.map((a) => (
                <article
                  key={a.id}
                  className="floating-answer-item"
                  aria-label={t(`回答：${a.question}`)}
                >
                  <div
                    className={`floating-question${a.images?.length ? ' has-images' : ''}`}
                    aria-label={t('面试问题')}
                  >
                    {a.screenshot !== 'only' && <span>{a.question}</span>}
                    <InterviewImages images={a.images} inInterview />
                    {a.screenshot && (
                      <span className="floating-screenshot-label">
                        <Screenshot size={14} />
                        {a.screenshot === 'only' ? t('截图提问') : t('附截图')}
                      </span>
                    )}
                  </div>
                  <div className="floating-answer-meta">
                    <div className="interview-answer-identity">
                      <span className="provider-identity">
                        <ProviderIdentity provider={a.provider ?? 'unknown'} />
                      </span>
                      <InterviewAnswerStatus answer={a} />
                    </div>
                    {a.content && (
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={t('复制面试回答')}
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(a.content);
                            setCopied(a.id);
                            setCopyError(null);
                          } catch {
                            setCopyError(a.id);
                          }
                        }}
                      >
                        {copied === a.id ? <Check size={14} /> : <Copy size={14} />}
                      </Button>
                    )}
                  </div>
                  <ResponseProgress
                    message={{
                      content: a.content,
                      status: a.status ?? 'completed',
                      mode: a.provider === 'mock' ? 'mock' : 'live',
                      activity: a.activity,
                      reasoningSummary: a.reasoningSummary,
                      startedAt: a.createdAt,
                    }}
                  />
                  {(a.content || (!a.retry && a.status !== 'failed' && a.status !== 'stopped')) && (
                    <div className="answer-text answer-bubble">
                      {a.content ? (
                        <MarkdownContent content={a.content} />
                      ) : state.generating && a.id === state.answers.at(-1)?.id ? (
                        <span className="answer-pending">{t('正在生成回答…')}</span>
                      ) : (
                        t('未收到回答。')
                      )}
                      {state.generating && a.id === state.answers.at(-1)?.id && (
                        <span className="typing-caret" />
                      )}
                    </div>
                  )}
                  {a.status === 'failed' && (
                    <InterviewAnswerFailure
                      answer={a}
                      disabled={state.generating}
                      live={a.id === failedAnswer?.id}
                      onRetry={() => void state.retryAnswer(a.id)}
                    />
                  )}
                  {a.status === 'stopped' && (
                    <div className="floating-answer-actions">
                      <Button
                        variant="outline"
                        className="interview-answer-retry"
                        disabled={state.generating}
                        onClick={() => void state.retryAnswer(a.id)}
                      >
                        <Refresh size={16} />
                        {t('重试面试回答')}
                      </Button>
                    </div>
                  )}
                  {(copied === a.id || copyError === a.id) && (
                    <small role="status">
                      {copyError === a.id ? t('复制失败，请选择文字后复制。') : t('已复制回答')}
                    </small>
                  )}
                </article>
              ))}
            </div>
            <FollowLatestButton
              label={answerScroll.hasNew ? t('有新回答 · 返回最新') : t('返回最新回答')}
              busy={state.generating}
              visible={state.generating || !answerScroll.following}
              onClick={answerScroll.scrollToLatest}
            />
            <form
              className="floating-composer"
              onSubmit={(event) => {
                event.preventDefault();
                submit();
              }}
            >
              {state.screenshots.length > 0 && (
                <div
                  className="floating-screenshot-previews"
                  role="group"
                  aria-label={t('待发送截图')}
                >
                  {state.screenshots.map((shot, index) => (
                    <div className="floating-screenshot-preview" key={shot.id}>
                      <img src={shot.preview} alt={t(`截图 ${index + 1}`)} />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={t(`移除截图 ${index + 1}`)}
                        disabled={state.generating}
                        onClick={() => void state.removeScreenshot(shot.id)}
                      >
                        <X size={12} />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
              <textarea
                ref={inputRef}
                aria-label={t('面试提问')}
                placeholder={t(
                  state.inputMode === 'transcription'
                    ? '输入问题，或按 Enter 发送最新转写…'
                    : '输入问题，或按 Enter 发送最新面试官问题…',
                )}
                rows={1}
                maxLength={6000}
                value={currentInput}
                onChange={(event) => state.setInputDraft(event.target.value)}
                onCompositionStart={() => state.setInputDraftComposing(true)}
                onCompositionEnd={() => state.setInputDraftComposing(false)}
                onBlur={() => state.setInputDraftComposing(false)}
                onKeyDown={(event) => {
                  if (
                    matchesShortcut(shortcutSettings.bindings['submit-input'], event, macScreenshotShortcut)
                  ) {
                    event.preventDefault();
                    return;
                  }
                  if (event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.altKey &&
                    !event.metaKey && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    submit();
                  }
                }}
              />
              <div className="floating-composer-toolbar">
                <div className="floating-composer-options">
                  <Button
                    type="button"
                    variant="ghost"
                    className="floating-toggle"
                    aria-label={t('静音后自动提交完整问题')}
                    aria-pressed={state.autoAnswer}
                    onClick={() => state.setAutoAnswer(!state.autoAnswer)}
                  >
                    <span className="toggle-dot" />
                    <Sparkles size={14} />
                    {t('自动回答：')}
                    {state.autoAnswer ? t('开') : t('关')}
                  </Button>
                </div>
                <div className="floating-composer-actions">
                  <Button
                    type="button"
                    variant="ghost"
                    className="floating-screenshot-button"
                    aria-label={t('截取图像')}
                    aria-keyshortcuts={screenshotShortcut?.replace('Super', 'Meta').replace('Command', 'Meta') ?? undefined}
                    aria-busy={state.capturingScreenshot}
                    data-expanded={screenshotExpanded}
                    data-shortcut-platform={macScreenshotShortcut ? 'macos' : 'windows'}
                    style={{ '--screenshot-shortcut-width': `${screenshotKeyLabel.length}ch` } as CSSProperties}
                    disabled={
                      state.generating ||
                      state.capturingScreenshot ||
                      !state.aiEnabled ||
                      state.screenshots.length >= 5
                    }
                    onClick={() => void state.captureScreenshot()}
                  >
                    {state.capturingScreenshot ? (
                      <span className="update-spinner">
                        <Loader size={18} />
                      </span>
                    ) : (
                      <Screenshot size={18} />
                    )}
                    <span className="floating-screenshot-text">{t('截图')}</span>
                    <kbd
                      className="floating-screenshot-shortcut"
                      aria-hidden="true"
                      hidden={screenshotExpanded}
                    >
                      {screenshotKeyLabel}
                    </kbd>
                    <span className="floating-screenshot-count" aria-live="polite">
                      {state.screenshots.length}/5
                    </span>
                  </Button>
                  {state.generating ? (
                    <Button
                      className="send-button"
                      type="button"
                      size="icon"
                      aria-label={t('停止当前回答')}
                      onClick={(event) => {
                        // Stopping immediately replaces this control with Submit.
                        // Cancel the click's default action before React updates it.
                        event.preventDefault();
                        state.stopAnswer();
                      }}
                    >
                      <Square size={18} />
                    </Button>
                  ) : (
                    <Button
                      className="send-button"
                      type="submit"
                      size="icon"
                      disabled={
                        state.generating ||
                        state.updatingModel ||
                        state.capturingScreenshot ||
                        (!currentInput.trim() &&
                          !latestQuestion.trim() &&
                          !state.screenshots.length)
                      }
                      aria-label={t('发送面试问题')}
                    >
                      <ArrowUp size={18} />
                    </Button>
                  )}
                </div>
              </div>
            </form>
          </section>
        </div>
        {!collapsed && (
          <>
            <span id="resize-keyboard-hint" className="sr-only">
              {t('方向键或加减键调整窗口大小；向上或向右放大，向下或向左缩小。')}
            </span>
            {resizeHandle('left')}
            {resizeHandle('right')}
          </>
        )}
        {!collapsed && (
          <footer className="floating-notices" aria-label={t('面试状态提示')}>
            {lowUsage && (
              <div className="floating-warning floating-usage-notice" role="status">
                {accountUsageSummary(connection.usage)}
              </div>
            )}
            {!collapsed && !protectedWindow && (
              <div className="floating-warning floating-capture-notice" role="status">
                {t('此窗口未隐藏')}
              </div>
            )}
            {noticeError && (
              <div className="floating-error" role="alert">
                {t(noticeError)}
              </div>
            )}
            {Object.entries(state.speechWarnings).map(([source, message]) => (
              <div key={source} className="floating-warning" role="status">
                {t(message)}
              </div>
            ))}
          </footer>
        )}
      </div>
      {settingsOpen && <InterviewSettingsPanel onClose={() => void changeSettings(false)} />}
      <RemoteConnectionDialogs onVisibilityChange={changeRemoteCanvas} />
    </div>
  );
}

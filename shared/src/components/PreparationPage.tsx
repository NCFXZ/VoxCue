import { InterviewReveal } from './InterviewReveal';
import { useInterviewAudioPreview } from './InterviewAudioPreview';
import { t, uiLocale } from '../i18n';
import { apiProviders, isApiProvider, type ApiBalance, type ApiProvider } from '../../electron/contracts/apiConnections';
import { hasReadySpeechModel, type ComponentId } from '../../electron/contracts/components';
import { useTextareaSize } from './useTextareaSize';
import { playSentMessageEnter } from '../lib/messageMotion';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { componentReady, useComponentReady, useComponents } from '../stores/components';
import type { OpenComponentSettings } from '../services/componentSettingsTargets';
import { userError } from '../services/errors';
import {
  speechComponent,
  speechModelLabels,
  speechSelection,
} from '../../electron/contracts/speechSettings';
import { ComponentsNotice } from './ComponentsNotice';
import { LocalImportNotice } from './LocalImportNotice';
import { SyncConflictNotice } from './SyncConflictNotice';
import { HomeNoticeSlot } from './SettingsNotice';
import { UpdateNotice } from './UpdateNotice';
import { AnnouncementNotice } from './AnnouncementNotice';
import type { AnnouncementTarget } from '../../electron/contracts/announcements';
import {
  ArrowUp,
  Square,
  X,
  Person,
  personalInfoIconSize,
  Play,
  Settings,
  Refresh,
  Save,
  FileText,
} from './icons';
import { Button } from './ui/button';
import { usePreparation } from '../stores/preparation';
import { useRemoteConnection } from '../stores/remoteConnection';
import { useAuth } from '../stores/auth';
import { ChatTools, ChatAttachments } from './ChatTools';
import { useFollowScroll } from './useFollowScroll';
import { defaultInterviewConfiguration, resolveInterviewConfiguration } from '../services/speech';
import type {
  AudioDevice,
  InterviewAccessReport,
  InterviewConfiguration,
} from '../../electron/contracts/speech';
import { useInterviewSettings } from '../stores/interviewSettings';
import { resolveInterviewInput, type InterviewInputMode } from '../services/interviewInput';
import { InterviewInputModeControl } from './InterviewInputModeControl';
import { AccessSkeleton, InterviewAccessList } from './InterviewAccessList';
import { useShortcuts } from '../stores/shortcuts';
import { useHeightTransition } from './ui/useHeightTransition';
import { useNoticeStackMotion } from './ui/useNoticeStackMotion';
import { Modal } from './ui/modal';
import { PanelResizeHandle } from './ui/PanelResizeHandle';
import { PreparationMessage } from './PreparationMessage';
import { PreparationGuide } from './PreparationGuide';
import { preparationActions, preparationStep } from '../services/preparationGuide';
import { PersonalInfoPanel } from './PersonalInfoPanel';
import { FollowLatestButton } from './FollowLatestButton';
import { localKnowledge } from '../services/knowledge';
import { readDroppedFiles, effortLabels } from '../services/chatOptions';
import { useChatConnection } from '../stores/chatConnection';
import { apiConnections } from '../services/apiConnections';
import { accountUsageSummaryParts } from '../services/accountUsageSummary';
import { AccountUsageSummary, InterviewApiBillingRow } from './AccountUsageSummary';
import { useModelProvider } from './useModelProvider';
import './preparation-notices.css';
import './chatMessages.css';
const inferenceDeviceLabels = { cpu: 'CPU', cuda: 'CUDA', metal: 'Metal' } as const;
export function PreparationPage({
  visible,
  onImportSettings,
  onComponentSettings,
  onSpeechSettings,
  onAISettings,
  onDraftChange,
  onAnnouncementAction,
}: {
  visible: boolean;
  onImportSettings?(): void;
  onComponentSettings?: OpenComponentSettings;
  onSpeechSettings?(): void;
  onAISettings?(locateProviders: boolean): void;
  onDraftChange?(dirty: boolean): void;
  onAnnouncementAction?(target: Exclude<AnnouncementTarget, 'personal-info'>): void;
}) {
  const state = usePreparation();
  const approvedDeviceRevision = useRemoteConnection(remote => remote.state?.approvalRevision);
  const ragReady = useComponentReady('rag');
  const connection = useChatConnection();
  const authResolved = useAuth((auth) => auth.resolved);
  const checkAiBeforeComponents = useAuth((auth) =>
    !auth.session && !auth.error && (auth.resolved || auth.startupChecked));
  const authBusy = useAuth((auth) => auth.loading || auth.waiting);
  const aiAction = useRef(0);
  const usageSummary = accountUsageSummaryParts(connection.usage, 'all');
  const lowUsage = connection.live && !connection.loadingUsage && usageSummary?.low;
  const interviewSettings = useInterviewSettings();
  const selectedSpeechComponent = speechComponent(interviewSettings.configuration.options);
  const speechReady = useComponentReady(selectedSpeechComponent);
  const conversationIds = useMemo(
    () => state.conversations.map((conversation) => conversation.id),
    [state.conversations],
  );
  const chatScroll = useFollowScroll(state.messages, state.activeConversation, {
    rememberPosition: true,
    identities: conversationIds,
  });
  const input = state.draft;
  const setInput = state.setDraft;
  const inputRef = useTextareaSize(input);
  const composerArea = useRef<HTMLDivElement>(null);
  const notices = useRef<HTMLDivElement>(null);
  useNoticeStackMotion(notices);
  const workspace = useRef<HTMLElement>(null);
  const measureComposerSpace = () => {
    const area = composerArea.current;
    const column = area?.closest<HTMLElement>('.chat-column');
    if (!area?.clientHeight || !column) return;
    const noticeHeight = notices.current?.getBoundingClientRect().height ?? 0;
    column.style.setProperty('--chat-notice-space', noticeHeight ? `${noticeHeight + 12}px` : '0px');
    column.style.setProperty('--chat-composer-height', `${area.getBoundingClientRect().height}px`);
  };
  const [sentMessage, setSentMessage] = useState<{ conversation: string; id: string } | null>(null);
  useLayoutEffect(() => usePreparation.subscribe((current, previous) => {
    if (current.activeConversation !== previous.activeConversation) {
      setSentMessage(null);
      return;
    }
    // Only a new send appends a user message and a streaming answer together.
    if (!current.activeConversation || !current.chatsReady || previous.streaming || !current.streaming ||
        current.messages.length !== previous.messages.length + 2) return;
    const user = current.messages.at(-2);
    const answer = current.messages.at(-1);
    if (user?.role === 'user' && answer?.role === 'assistant' && answer.status === 'streaming')
      setSentMessage({ conversation: current.activeConversation, id: user.id });
  }), []);
  useLayoutEffect(() => {
    if (!sentMessage || sentMessage.conversation !== state.activeConversation) return;
    playSentMessageEnter(workspace.current?.querySelector<HTMLElement>(
      `.chat-message.user[data-message-id="${CSS.escape(sentMessage.id)}"]`,
    ));
  }, [sentMessage, state.activeConversation]);
  const previousConversationIds = useRef(conversationIds);
  const previousView = useRef({ visible, ready: state.chatsReady, id: state.activeConversation });
  useLayoutEffect(() => {
    const previous = previousView.current;
    previousView.current = { visible, ready: state.chatsReady, id: state.activeConversation };
    if (!visible || !state.chatsReady) return;
    // Set the destination's layout and reading position before its first visible frame.
    measureComposerSpace();
    chatScroll.restorePosition();
    if (!previous.visible || !previous.ready || previous.id === state.activeConversation ||
        (state.activeConversation && !previousConversationIds.current.includes(state.activeConversation)) ||
        workspace.current?.closest<HTMLElement>('.page-stage')?.style.viewTransitionName) return;
    const content = workspace.current?.querySelector<HTMLElement>('.chat-scroll, .welcome');
    const preference = matchMedia('(prefers-reduced-motion: reduce)');
    if (!content?.getClientRects().length || preference.matches) return;
    const style = getComputedStyle(content);
    const value = style.getPropertyValue('--panel-motion-duration').trim();
    const duration = parseFloat(value) * (value.endsWith('ms') ? 1 : 1000);
    if (!Number.isFinite(duration) || duration <= 0) return;
    // Moving the viewport leaves the long thread's scrollable range unchanged.
    const animation = content.animate(
      [
        { opacity: 0, transform: 'translateY(8px)' },
        { opacity: 1, transform: 'translateY(0)' },
      ],
      { duration, easing: style.getPropertyValue('--panel-motion-easing').trim(), fill: 'both' },
    );
    const clear = () => {
      preference.removeEventListener('change', reduce);
      animation.cancel();
    };
    const reduce = () => {
      if (preference.matches) clear();
    };
    preference.addEventListener('change', reduce);
    void animation.finished.then(clear, () => {});
    return clear;
  }, [visible, state.activeConversation, state.chatsReady]);
  useLayoutEffect(() => {
    previousConversationIds.current = conversationIds;
  }, [conversationIds]);
  const [startActionWidth, setStartActionWidth] = useState<number>();
  useLayoutEffect(() => {
    const button = workspace.current?.querySelector<HTMLButtonElement>('.interview-start-trigger');
    if (!button) return;
    const measure = () => setStartActionWidth(button.getBoundingClientRect().width);
    const observer = new ResizeObserver(measure);
    observer.observe(button);
    measure();
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    const area = composerArea.current!;
    const column = area.closest<HTMLElement>('.chat-column')!;
    let frame = 0;
    const update = () => {
      measureComposerSpace();
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(chatScroll.syncLayout);
    };
    const resize = new ResizeObserver(update);
    resize.observe(area);
    if (notices.current) resize.observe(notices.current);
    update();
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      column.style.removeProperty('--chat-composer-height');
      column.style.removeProperty('--chat-notice-space');
    };
  }, []);
  const [confirmInterview, setConfirmInterview] = useState(false);
  const [balanceResult, setBalanceResult] = useState<{ provider: ApiProvider; balances: ApiBalance[] }>();
  const balanceProvider = confirmInterview && connection.live && isApiProvider(connection.service)
    && apiProviders[connection.service].balance ? connection.service : undefined;
  useEffect(() => {
    setBalanceResult(undefined);
    if (!balanceProvider) return;
    let current = true;
    void apiConnections.balance(balanceProvider).then(
      (balances) => { if (current) setBalanceResult({ provider: balanceProvider, balances }); },
      () => {}, // The billing label stays visible when the balance is unavailable.
    );
    return () => { current = false; };
  }, [balanceProvider]);
  const [openingInterview, setOpeningInterview] = useState(false);
  const [interviewError, setInterviewError] = useState<string | null>(null);
  const [interviewDevices, setInterviewDevices] = useState<AudioDevice[]>([]);
  const [accessReport, setAccessReport] = useState<InterviewAccessReport | null>(null);
  const [checkingAccess, setCheckingAccess] = useState(false);
  const accessAttempt = useRef(0);
  const [interviewConfiguration, setInterviewConfiguration] = useState(
    defaultInterviewConfiguration,
  );
  const { microphone, system, sources } = interviewConfiguration.options;
  const microphoneEnabled = sources.includes('microphone');
  const systemAudioEnabled = sources.includes('system');
  const audioSettingsChecks = checkingAccess
    ? []
    : (accessReport?.checks.filter(({ source, status }) =>
        source === 'microphone'
          ? status === 'denied'
          : window.desktop?.platform === 'macos' && status !== 'granted',
      ) ?? []);
  const previewEnabled = confirmInterview && !checkingAccess && !openingInterview && !interviewError;
  const canPreview = (source: 'microphone' | 'system') => previewEnabled &&
    !!accessReport?.checks.some(check => check.source === source && check.status === 'granted');
  const preview = useInterviewAudioPreview(canPreview('microphone'), canPreview('system'), interviewConfiguration.options);
  const audioSummary = useRef<HTMLDListElement>(null);
  const accessChecks = useRef<HTMLDivElement>(null);
  useHeightTransition(
    `${confirmInterview}:${interviewConfiguration.inputMode ?? 'remote'}:${checkingAccess}`,
    () => [audioSummary.current, accessChecks.current],
  );
  const interviewSpeech = speechSelection(interviewConfiguration.options);
  const interviewModel = connection.models.find((model) => model.id === interviewConfiguration.modelId);
  const interviewProvider = useModelProvider(interviewConfiguration.modelId);
  const [infoOpen, setInfoOpen] = useState(false);
  const [panelWidth, setPanelWidth] = useState(380);
  const layoutRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const layout = layoutRef.current;
    if (!layout) return;
    const measure = () =>
      layout.style.setProperty(
        '--personal-panel-width',
        `${Math.min(panelWidth, Math.max(0, layout.clientWidth - 260))}px`,
      );
    const resize = new ResizeObserver(measure);
    resize.observe(layout);
    measure();
    return () => resize.disconnect();
  }, [panelWidth]);
  const [profileError, setProfileError] = useState<string | null>(null);
  const visibleError =
    state.chatStorageError ||
    connection.error ||
    (state.error &&
    !state.messages.some((message) => message.error === state.error) &&
    !(infoOpen && profileError === state.error)
      ? state.error
      : null);
  const [copied, setCopied] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  useEffect(() => {
    const resetDrag = () => {
      dragDepth.current = 0;
      setDragging(false);
    };
    resetDrag();
    window.addEventListener('dragend', resetDrag);
    window.addEventListener('drop', resetDrag);
    window.addEventListener('blur', resetDrag);
    return () => {
      window.removeEventListener('dragend', resetDrag);
      window.removeEventListener('drop', resetDrag);
      window.removeEventListener('blur', resetDrag);
    };
  }, [state.activeConversation]);
  const [interviewKnowledgeName, setInterviewKnowledgeName] = useState('不使用知识库');

  useEffect(() => {
    void state.load();
  }, []);

  const openInfo = () => {
    setInfoOpen(true);
  };
  const closeInfo = () => {
    setInfoOpen(false);
    requestAnimationFrame(() =>
      document.querySelector<HTMLButtonElement>(`[aria-label="${t('个人信息')}"]`)?.focus(),
    );
  };
  const askProfile = (prompt: string, uploadResume = false) => {
    state.setDraft([state.draft.trim(), prompt].filter(Boolean).join('\n\n'));
    setInfoOpen(false);
    requestAnimationFrame(() => {
      document.querySelector<HTMLTextAreaElement>(`[aria-label="${t('聊天消息')}"]`)?.focus();
      if (uploadResume)
        document.querySelector<HTMLInputElement>(`[aria-label="${t('添加聊天文件')}"]`)?.click();
    });
  };
  const submit = () => {
    if ((!input.trim() && !state.attachments.length) || state.streaming) return;
    const text = input;
    void state.send(text);
  };
  const startConfiguration = () => {
    const settings = useInterviewSettings.getState();
    const { models, live } = useChatConnection.getState();
    return resolveInterviewInput(
      resolveInterviewConfiguration(settings.configuration, models, live),
      settings.inputMode,
    );
  };
  const changeInputMode = (inputMode: InterviewInputMode) => {
    if (openingInterview || inputMode === interviewSettings.inputMode) return;
    const settings = useInterviewSettings.getState();
    settings.setInputMode(inputMode);
    if (useInterviewSettings.getState().inputMode !== inputMode) {
      setInterviewError(useInterviewSettings.getState().error);
      return;
    }
    ++accessAttempt.current;
    setAccessReport(null);
    setCheckingAccess(true);
    setInterviewDevices([]);
    const configuration = startConfiguration();
    configuration.profile = interviewConfiguration.profile;
    configuration.knowledgeBaseId = interviewConfiguration.knowledgeBaseId;
    setInterviewConfiguration(configuration);
  };
  const readyForAI = async (action: 'interview' | 'skills') => {
    const request = ++aiAction.current;
    const previous = usePreparation.getState();
    await useAuth.getState().ensure();
    const current = usePreparation.getState();
    if (
      request !== aiAction.current ||
      !workspace.current ||
      workspace.current.closest('[hidden]') ||
      document.querySelector('dialog[open]') ||
      current.activeConversation !== previous.activeConversation ||
      current.info !== previous.info ||
      current.draft !== previous.draft
    )
      return false;
    const auth = useAuth.getState();
    if (auth.waiting || auth.error) return false;
    if (auth.resolved && !auth.session) {
      onAISettings?.(action === 'skills');
      return false;
    }
    const { live, models } = useChatConnection.getState();
    return live && models.length > 0;
  };
  const beginInterview = async () => {
    if (!(await readyForAI('interview'))) return;
    const current = usePreparation.getState();
    const selectedSpeech = speechComponent(useInterviewSettings.getState().configuration.options);
    const missing: ComponentId[] = [];
    if (!componentReady(selectedSpeech)) missing.push(selectedSpeech);
    if (current.selectedKnowledgeBaseId && !componentReady('rag')) missing.push('rag');
    if (missing.length) {
      const catalog = useComponents.getState().state;
      onComponentSettings?.({
        required: missing,
        anySpeech: !catalog || catalog.phase === 'checking' || !hasReadySpeechModel(catalog),
      });
      return;
    }
    setInterviewError(null);
    setAccessReport(null);
    setCheckingAccess(true);
    const configuration = startConfiguration();
    configuration.profile = structuredClone(current.info);
    configuration.knowledgeBaseId = current.selectedKnowledgeBaseId;
    setInterviewDevices([]);
    setInterviewConfiguration(configuration);
    setConfirmInterview(true);
  };
  const audioName = (source: 'system' | 'microphone') => {
    if (source === 'microphone' && !interviewConfiguration.options.sources.includes(source))
      return t('不使用麦克风');
    const id = interviewConfiguration.options[source];
    if (
      accessReport?.checks.some(
        (check) => check.source === source && check.status === 'unavailable',
      )
    )
      return t(`${id ? '所选' : '默认'}${source === 'system' ? '播放设备' : '麦克风'}不可用`);
    return (
      interviewDevices.find(
        (device) => device.source === source && (id ? device.id === id : device.default),
      )?.name ?? t(source === 'system' ? '默认播放设备' : '默认麦克风')
    );
  };
  const guide = () => (
    <PreparationGuide
      actions={preparationActions(state.info, state.skillsNeedUpdate)}
      step={preparationStep(state.info, state.skillsNeedUpdate)}
      disabled={!state.chatsReady || state.streaming || connection.loading || authBusy}
      onAction={async (action) => {
        if (action === 'profile') {
          state.dismissSkillUpdate();
          openInfo();
          return;
        }
        if (action === 'interview') {
          state.dismissSkillUpdate();
          await beginInterview();
          return;
        }
        if (action === 'skills') {
          if (await readyForAI('skills')) await usePreparation.getState().generateSkills();
          return;
        }
        state.dismissSkillUpdate();
        if (action === 'upload')
          askProfile(
            t(
              '请根据本次上传的简历整理摘要，保留教育与工作背景、职责、项目、关键技术和已有成果，准确区分个人贡献、团队成果及进行中事项。合并重复表述，不补造事实。仅提出简历摘要的待确认更新，不修改其他资料。如果本次摘要有变化，且提案与已保存资料合并后简历和JD摘要都非空，请在回复末尾问一句：确认保存后是否需要生成相关面试技能；已有技能时改为询问是否更新。本次不生成技能。',
            ),
            true,
          );
        else
          askProfile(
            t(
              '请根据以下内容整理{0}摘要。简历保留个人经历、职责、项目、技术和成果；职位描述保留岗位定位、职责、任职要求及明确的优先条件。合并重复表述，保留事实和条件边界，不把岗位要求写成个人经历。仅提出该摘要的待确认更新，不修改其他资料。如果本次摘要有变化，且提案与已保存资料合并后简历和JD摘要都非空，请在回复末尾问一句：确认保存后是否需要生成相关面试技能；已有技能时改为询问是否更新。本次不生成技能。\n\n以下是{0}内容：\n',
              [t(action === 'resume' ? '简历' : '职位描述')],
            ),
          );
      }}
    />
  );
  const checkAccess = async (configuration: InterviewConfiguration, startError?: string) => {
    const attempt = ++accessAttempt.current;
    const current = () => attempt === accessAttempt.current;
    setCheckingAccess(true);
    setAccessReport(null);
    setInterviewError(startError ?? null);
    try {
      if (configuration.knowledgeBaseId) {
        const selectedBase = (await localKnowledge.listBases()).find(
          (base) => base.id === configuration.knowledgeBaseId,
        );
        if (!current()) return;
        if (!selectedBase) throw Error('所选面试知识库已删除，请在个人信息中重新选择。');
        setInterviewKnowledgeName(selectedBase.name);
      } else setInterviewKnowledgeName('不使用知识库');
      if (!current()) return;
      const [report] = await Promise.all([
        window.desktop!.checkInterviewAccess({
          ...defaultInterviewConfiguration(),
          inputMode: configuration.inputMode,
          options: configuration.options,
          knowledgeBaseId: configuration.knowledgeBaseId,
        }),
        useShortcuts.getState().call({ op: 'check' }),
      ]);
      if (!current()) return;
      setAccessReport(report);
      setInterviewDevices(report.devices);
    } catch (error) {
      if (current())
        setInterviewError(startError ?? userError(error, '无法检查面试权限，请重新检查。'));
    } finally {
      queueMicrotask(() => {
        if (current()) setCheckingAccess(false);
      });
    }
  };
  useEffect(() => {
    if (!confirmInterview) return;
    setInterviewConfiguration((current) => ({
      ...startConfiguration(),
      profile: current.profile,
      knowledgeBaseId: current.knowledgeBaseId,
    }));
  }, [
    confirmInterview,
    interviewSettings.inputMode,
    interviewSettings.configuration.modelId,
    interviewSettings.configuration.effort,
    connection.live,
    connection.models,
  ]);
  useEffect(() => {
    if (confirmInterview) void checkAccess(interviewConfiguration);
  }, [
    confirmInterview,
    interviewConfiguration.inputMode,
    interviewConfiguration.knowledgeBaseId,
    microphone,
    system,
    microphoneEnabled,
    systemAudioEnabled,
  ]);
  useEffect(() => {
    if (!confirmInterview || !window.desktop?.screenCapturePermissionSupported) return;
    let active = true;
    const refresh = () => {
      const attempt = accessAttempt.current;
      void window
        .desktop!.screenCapturePermission('check')
        .then((permission) => {
          if (active && attempt === accessAttempt.current)
            setAccessReport((current) =>
              current ? { ...current, screenCapture: permission } : current,
            );
        })
        .catch(() => {
          if (active && attempt === accessAttempt.current)
            setAccessReport((current) =>
              current
                ? {
                    ...current,
                    screenCapture: { status: 'error', message: '屏幕捕获权限检查失败，请重新检查' },
                  }
                : current,
            );
        });
    };
    window.addEventListener('focus', refresh);
    return () => {
      active = false;
      window.removeEventListener('focus', refresh);
    };
  }, [confirmInterview]);
  return (
    <main ref={workspace} className="workspace preparation-workspace">
      <header className="page-toolbar">
        <div className="breadcrumb">
          <strong>{t('面试准备')}</strong>
        </div>
        <div className="toolbar-actions">
          <Button
            variant="ghost"
            aria-label={t('个人信息')}
            aria-expanded={infoOpen}
            aria-controls="personal-info-panel"
            onClick={() => (infoOpen ? closeInfo() : openInfo())}
          >
            <Person size={personalInfoIconSize} />
            {t('个人信息')}
          </Button>
          <Button
            className="interview-start-trigger"
            disabled={
              !window.desktop ||
              openingInterview ||
              authBusy ||
              connection.loading ||
              (!checkAiBeforeComponents &&
                (!speechReady || (!!state.selectedKnowledgeBaseId && !ragReady) ||
                  (authResolved && (!connection.live || !connection.models.length))))
            }
            onClick={beginInterview}
          >
            <Play size={15} />
            {t('开始面试')}
          </Button>
        </div>
      </header>
      {confirmInterview && (
        <Modal
          title={t('开始面试')}
          className="interview-start-dialog"
          subtitle={t('音频、模型和显示设置可在面试中调整。')}
          footer={
            <>
              <p className="interview-start-description">
                {interviewConfiguration.autoRecord ? t('本场面试将自动录音，仅保存在本机。') : t('本场面试默认不录音。')}
                {interviewConfiguration.mode === 'local' &&
                  interviewConfiguration.aiEnabled &&
                  t(' 回答资料发至 {0}。', [interviewProvider.dataRecipient])}
              </p>
              <div className="interview-start-actions">
                <Button
                  style={uiLocale() === 'en' ? { width: startActionWidth } : undefined}
                  variant="outline"
                  data-autofocus
                  disabled={openingInterview}
                  onClick={() => {
                    ++accessAttempt.current;
                    setConfirmInterview(false);
                  }}
                >
                  <X size={16} />
                  {t('取消')}
                </Button>
                <Button
                  style={{ width: startActionWidth, paddingInline: 8 }}
                  disabled={
                    openingInterview ||
                    checkingAccess ||
                    !!interviewError ||
                    !accessReport?.ready ||
                    !speechReady ||
                    (!!state.selectedKnowledgeBaseId && !ragReady) ||
                    !connection.live ||
                    !interviewModel
                  }
                  onClick={async () => {
                    if (!window.desktop || openingInterview) return;
                    setOpeningInterview(true);
                    try {
                      await preview.stop.current();
                      await window.desktop.openInterview({
                        ...interviewConfiguration,
                        ...(interviewConfiguration.knowledgeBaseId
                          ? { knowledgeBaseName: interviewKnowledgeName }
                          : {}),
                      }, approvedDeviceRevision);
                      setConfirmInterview(false);
                    } catch (error) {
                      await checkAccess(interviewConfiguration, userError(error, '面试窗口打开失败，请重试。'));
                    } finally {
                      setOpeningInterview(false);
                    }
                  }}
                >
                  <Play size={15} />
                  {openingInterview ? t('正在打开…') : t('确认开始')}
                </Button>
              </div>
            </>
          }
          onClose={() => {
            if (!openingInterview) {
              ++accessAttempt.current;
              setConfirmInterview(false);
            }
          }}
        >
          <InterviewInputModeControl
            value={interviewSettings.inputMode}
            onChange={changeInputMode}
            disabled={openingInterview}
          />
          <div className="interview-start-content">
            <div className="interview-start-summary" role="group" aria-label={t('当前面试设置')}>
              <dl className="interview-start-summary-group">
                <div className="interview-start-knowledge">
                  <dt>{t('面试知识库')}</dt>
                  <dd>
                    {state.selectedKnowledgeBaseId ? interviewKnowledgeName : t('不使用知识库')}
                  </dd>
                </div>
                {connection.live && !connection.loadingUsage && isApiProvider(connection.service) ? (
                  <InterviewApiBillingRow provider={connection.service}
                    balances={balanceResult?.provider === connection.service ? balanceResult.balances : undefined} />
                ) : (
                  <div>
                    <dt>{connection.live && usageSummary ? usageSummary.title : t('AI 服务用量')}</dt>
                    <dd className={lowUsage ? 'account-usage-low' : undefined}>
                      {!connection.live ? (
                        t('未连接 AI 服务')
                      ) : connection.loadingUsage ? (
                        t('正在读取…')
                      ) : (
                        <AccountUsageSummary
                          usage={connection.usage}
                          showHeading={false}
                          mode="all"
                        />
                      )}
                    </dd>
                  </div>
                )}
              </dl>
              <dl ref={audioSummary} className="interview-start-summary-group">
                {interviewConfiguration.inputMode !== 'transcription' && (
                  <div>
                    <dt>{t('系统音频 · 面试官')}</dt>
                    <dd>
                      {checkingAccess ? (
                        <AccessSkeleton className="interview-access-device-slot">
                          {audioName('system')}
                        </AccessSkeleton>
                      ) : (
                        audioName('system')
                      )}
                    </dd>
                  </div>
                )}
                <div>
                  <dt>{t('麦克风 · 面试者')}</dt>
                  <dd>
                    {checkingAccess &&
                    interviewConfiguration.options.sources.includes('microphone') ? (
                      <AccessSkeleton className="interview-access-device-slot">
                        {audioName('microphone')}
                      </AccessSkeleton>
                    ) : (
                      audioName('microphone')
                    )}
                  </dd>
                </div>
              </dl>
              <dl className="interview-start-summary-group interview-start-summary-models">
                <div>
                  <dt>{t('回答模型')}</dt>
                  <dd>
                    <span className="interview-start-summary-value">
                      {interviewConfiguration.aiEnabled
                        ? (interviewModel?.label ?? t('模型不可用'))
                        : t('未选择模型')}
                    </span>
                    <span
                      className="interview-start-summary-meta"
                      role="group"
                      aria-label={t('思考强度')}
                    >
                      {t(effortLabels[interviewConfiguration.effort])}
                    </span>
                  </dd>
                </div>
                <div>
                  <dt>{t('语音模型')}</dt>
                  <dd>
                    <span className="interview-start-summary-value">
                      {t(speechModelLabels[interviewSpeech.speechModel])}
                    </span>
                    <span
                      className="interview-start-summary-meta"
                      role="group"
                      aria-label={t('推理设备')}
                    >
                      {t(inferenceDeviceLabels[interviewSpeech.inferenceDevice])}
                    </span>
                  </dd>
                </div>
              </dl>
            </div>
            <section
              className="interview-access"
              aria-label={t('权限与设备检查')}
              aria-busy={checkingAccess}
            >
              <div className="interview-access-heading">
                <h3>{t('设备与权限')}</h3>
                <Button
                  variant="ghost"
                  style={{ width: startActionWidth, paddingInline: 8 }}
                  disabled={openingInterview || checkingAccess}
                  onClick={() => void checkAccess(interviewConfiguration)}
                >
                  <Refresh size={16} />
                  {t('重新检查')}
                </Button>
              </div>
              <div ref={accessChecks} className="interview-access-checks">
                <InterviewAccessList
                  checking={checkingAccess}
                  sources={interviewConfiguration.options.sources}
                  report={accessReport}
                />
              </div>
              <InterviewReveal resizeKey={preview.error ?? ''}>
                {preview.error ? <p className="interview-access-detail danger-text" role="alert">{t(preview.error)}</p> : null}
              </InterviewReveal>
              <InterviewReveal>
                {audioSettingsChecks.length > 0 ? (
                  <div className="interview-access-actions">
                    {audioSettingsChecks.map(({ source }) => (
                      <Button
                        key={source}
                        variant="outline"
                        onClick={() => {
                          const attempt = accessAttempt.current;
                          void window.desktop!.openMicrophoneSettings(source).catch(() => {
                            if (attempt === accessAttempt.current)
                              setInterviewError('无法打开系统设置，请手动打开音频隐私设置。');
                          });
                        }}
                      >
                        <Settings size={16} />
                        {source === 'microphone'
                          ? t('打开麦克风权限设置')
                          : t('打开系统音频权限设置')}
                      </Button>
                    ))}
                  </div>
                ) : null}
              </InterviewReveal>
            </section>
            <InterviewReveal resizeKey={interviewSettings.error ?? ''}>
              {interviewSettings.error ? (
                <p role="alert" className="danger-text">
                  {t(interviewSettings.error)}
                </p>
              ) : null}
            </InterviewReveal>
            <InterviewReveal>
              {connection.live && !connection.loading && connection.models.length > 0 && !interviewModel ? (
                <p role="alert" className="danger-text">{t('所选模型当前不可用，请重新选择模型。')}</p>
              ) : null}
            </InterviewReveal>
            <InterviewReveal resizeKey={interviewError ?? ''}>
              {interviewError ? (
                <p role="alert" className="danger-text">
                  {t(interviewError)}
                </p>
              ) : null}
            </InterviewReveal>
          </div>
        </Modal>
      )}
      <div
        ref={layoutRef}
        className={`preparation-layout${infoOpen ? ' has-personal-info' : ''}`}
      >
        <div
          className="chat-column"
          onDragEnter={(event) => {
            if (!event.dataTransfer.types.includes('Files')) return;
            event.preventDefault();
            if (!state.chatsReady) return;
            dragDepth.current++;
            setDragging(true);
          }}
          onDragOver={(event) => {
            if (!event.dataTransfer.types.includes('Files')) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = state.chatsReady ? 'copy' : 'none';
          }}
          onDragLeave={(event) => {
            if (!event.dataTransfer.types.includes('Files')) return;
            event.preventDefault();
            dragDepth.current = Math.max(0, dragDepth.current - 1);
            if (!dragDepth.current) setDragging(false);
          }}
          onDrop={(event) => {
            if (!event.dataTransfer.types.includes('Files')) return;
            event.preventDefault();
            dragDepth.current = 0;
            setDragging(false);
            if (!state.chatsReady) return;
            const conversation = state.activeConversation;
            void readDroppedFiles(event.dataTransfer)
              .then((files) => {
                const current = usePreparation.getState();
                if (!current.chatsReady) return;
                if (current.activeConversation !== conversation)
                  throw Error('读取文件期间已切换对话，请在当前对话重新拖入文件。');
                current.addAttachments(files);
              })
              .catch((error) =>
                usePreparation.setState({
                  error: error instanceof Error ? error.message : '读取文件失败。',
                }),
              );
          }}
        >
          {dragging && (
            <div className="chat-drop-hint" role="status">
              <div className="chat-drop-card">
                <span className="chat-drop-icon" aria-hidden="true">
                  <FileText size={32} />
                </span>
                <strong>{t('添加到当前对话')}</strong>
                <p>{t('将文件或文件夹拖到这里，松开即可添加')}</p>
                <div className="chat-drop-limits">
                  <span>{t('最多 20 个文件')}</span>
                  <span>{t('单个不超过 20 MB')}</span>
                </div>
              </div>
            </div>
          )}
          <div ref={notices} className="chat-settings-notices">
            <UpdateNotice />
            <AnnouncementNotice onNavigate={(target) => {
              if (target === 'personal-info') openInfo();
              else onAnnouncementAction?.(target);
            }} />
            <HomeNoticeSlot>
              <SyncConflictNotice />
            </HomeNoticeSlot>
            <HomeNoticeSlot>
              <LocalImportNotice onSettings={onImportSettings} />
            </HomeNoticeSlot>
            <HomeNoticeSlot>
              <ComponentsNotice
                onSettings={onComponentSettings}
                onPerformanceSettings={onSpeechSettings}
                speechOptions={interviewSettings.configuration.options}
              />
            </HomeNoticeSlot>
          </div>
          {state.messages.length ? (
            <div
              className="chat-scroll"
              {...chatScroll.scrollProps}
              tabIndex={0}
              aria-label={t('聊天内容')}
            >
              <div className="chat-thread">
                {state.messages.map((message, index) => (
                  <PreparationMessage
                    key={message.id}
                    message={message}
                    timestamp={
                      message.startedAt ??
                      (message.role === 'user' && state.messages[index + 1]?.role === 'assistant'
                        ? state.messages[index + 1].startedAt
                        : undefined)
                    }
                    copied={copied === message.id ? copied : null}
                    onCopied={setCopied}
                    retryDisabled={
                      index === state.messages.length - 1 && ['failed', 'stopped'].includes(message.status ?? '')
                        ? state.streaming || authBusy || (authResolved && !connection.models.length)
                        : undefined
                    }
                    onRetry={state.retry}
                  />
                ))}
              </div>
            </div>
          ) : state.chatsReady ? (
            <section className="welcome">{guide()}</section>
          ) : null}
          <div ref={composerArea} className="composer-area chat-composer">
            <FollowLatestButton
              visible={(state.streaming || !chatScroll.following) && state.messages.length > 0}
              label={chatScroll.hasNew ? t('有新回复 · 返回最新') : t('返回最新回复')}
              busy={state.streaming}
              onClick={chatScroll.scrollToLatest}
            />
            <div className="preparation-notices">
              <InterviewReveal resizeKey={visibleError || 'offline'}>
                {(visibleError || (authResolved && !connection.live)) ? (
                  <p
                    role={visibleError ? 'alert' : undefined}
                    className={`simulation-disclaimer ${visibleError ? 'danger-text' : ''}`}
                  >
                    {t(visibleError || '请先连接模型服务。')}
                  </p>
                ) : null}
              </InterviewReveal>
              <InterviewReveal>
                {connection.error ? (
                  <Button
                    variant="outline"
                    disabled={connection.loading}
                    onClick={() => void connection.load(true, true)}
                  >
                    <Refresh size={16} />
                    {t('重新加载模型')}
                  </Button>
                ) : null}
              </InterviewReveal>
              <InterviewReveal>
                {state.chatStorageError ? (
                  <Button
                    variant="outline"
                    onClick={() => {
                      if (state.chatsReady) void state.flushChats();
                      else void state.restoreChats();
                    }}
                  >
                    {state.chatsReady ? <Save size={16} /> : <Refresh size={16} />}
                    {state.chatsReady ? t('重试保存聊天') : t('重新读取聊天')}
                  </Button>
                ) : null}
              </InterviewReveal>
            </div>
            <>
              <form
                className="composer"
                onSubmit={(event) => {
                  event.preventDefault();
                  submit();
                }}
              >
                <ChatAttachments />
                <textarea
                  ref={inputRef}
                  disabled={!state.chatsReady}
                  aria-label={t('聊天消息')}
                  placeholder={t('询问面试准备问题，或告诉我你的目标岗位…')}
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (
                      event.key === 'Enter' &&
                      !event.shiftKey &&
                      !event.nativeEvent.isComposing
                    ) {
                      event.preventDefault();
                      submit();
                    }
                  }}
                  rows={2}
                />
                <div className="composer-bottom">
                  <div className="composer-tools">
                    <ChatTools
                      actions={
                        <div className="composer-actions">
                          {state.streaming ? (
                            <Button
                              key="stop"
                              className="send-button"
                              type="button"
                              size="icon"
                              aria-label={t('停止回复')}
                              onClick={(event) => {
                                event.preventDefault();
                                state.stop();
                              }}
                            >
                              <Square size={18} />
                            </Button>
                          ) : (
                            <Button
                              key="send"
                              className="send-button"
                              size="icon"
                              type="submit"
                              disabled={
                                !state.chatsReady ||
                                (!input.trim() && !state.attachments.length) ||
                                authBusy ||
                                (authResolved && !connection.models.length)
                              }
                              aria-label={t('发送消息')}
                            >
                              <ArrowUp size={20} />
                            </Button>
                          )}
                        </div>
                      }
                    />
                  </div>
                </div>
              </form>
            </>
          </div>
        </div>
        <PersonalInfoPanel
          resizeHandle={
            infoOpen && (
              <PanelResizeHandle
                layoutRef={layoutRef}
                label={t('调整个人信息宽度')}
                controls="personal-info-panel"
                draggingClassName="is-resizing-info"
                onResize={setPanelWidth}
                onReset={() => setPanelWidth(380)}
              />
            )
          }
          open={infoOpen}
          onDirtyChange={onDraftChange}
          onErrorChange={setProfileError}
          onComponentSettings={onComponentSettings}
        />
      </div>
    </main>
  );
}

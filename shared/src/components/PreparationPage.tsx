import { t, uiLocale } from '../i18n';
import { componentPresentation } from '../../electron/contracts/components';
import { useTextareaSize } from './useTextareaSize';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { componentReady, useComponentReady } from '../stores/components';
import { userError } from '../services/errors';
import {
  speechComponent,
  speechModelLabels,
  speechSelection,
} from '../../electron/contracts/speechSettings';
import { ComponentsNotice } from './ComponentsNotice';
import { AudioCheck } from './AudioCheck';
import {
  ArrowUp,
  Check,
  Copy,
  MessageSquare,
  Square,
  X,
  Person,
  Play,
  Monitor,
  Settings,
  Refresh,
  Save,
  FileText,
} from './icons';
import { Button } from './ui/button';
import { ConfirmDeleteButton } from './ui/confirm-delete-button';
import { usePreparation } from '../stores/preparation';
import { ChatTools, ChatAttachments } from './ChatTools';
import { useFollowScroll } from './useFollowScroll';
import { defaultInterviewConfiguration, resolveInterviewConfiguration } from '../services/speech';
import type {
  AudioDevice,
  InterviewAccessReport,
  InterviewConfiguration,
} from '../../electron/contracts/speech';
import { useInterviewSettings } from '../stores/interviewSettings';
import { Modal } from './ui/modal';
import { ProfileProposal } from './ProfileProposal';
import { PreparationGuide } from './PreparationGuide';
import { preparationActions, preparationStep } from '../services/preparationGuide';
import { MarkdownContent } from './MarkdownContent';
import { PersonalInfoPanel } from './PersonalInfoPanel';
import { FollowLatestButton } from './FollowLatestButton';
import { localKnowledge } from '../services/knowledge';
import { ProviderIdentity } from './ProviderIdentity';
import { ResponseProgress } from './ResponseProgress';
import { ChatSources } from './ChatSources';
import { readDroppedFiles, effortLabels } from '../services/chatOptions';
import { useChatConnection } from '../stores/chatConnection';
import { accountUsageSummary } from '../services/accountUsageSummary';
import { useModelProvider } from './useModelProvider';
const audioAccessLabels = {
  granted: '可用',
  denied: '未授权',
  unavailable: '设备不可用',
  error: '检查失败',
};
const inferenceDeviceLabels = { cpu: 'CPU', cuda: 'CUDA', metal: 'Metal' } as const;
const screenAccessLabels = {
  granted: '可用',
  'not-required': '无需单独授权',
  'not-determined': '未授权',
  denied: '未授权',
  restricted: '受限制',
  unknown: '待确认',
  error: '检查失败',
};
export function PreparationPage({
  onComponentSettings,
  onSpeechSettings,
  onAISettings,
  onDraftChange,
}: {
  onComponentSettings?(): void;
  onSpeechSettings?(): void;
  onAISettings?(): void;
  onDraftChange?(dirty: boolean): void;
}) {
  const state = usePreparation();
  const ragReady = useComponentReady('rag');
  const connection = useChatConnection();
  const interviewSettings = useInterviewSettings();
  const selectedSpeechComponent = speechComponent(interviewSettings.configuration.options);
  const speechReady = useComponentReady(selectedSpeechComponent);
  const chatScroll = useFollowScroll(state.messages, state.activeConversation);
  const input = state.draft;
  const setInput = state.setDraft;
  const inputRef = useTextareaSize(input);
  const composerArea = useRef<HTMLDivElement>(null);
  const workspace = useRef<HTMLElement>(null);
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
    let notice: Element | null = null;
    const update = () => {
      column.style.setProperty(
        '--chat-notice-space',
        notice ? `${notice.getBoundingClientRect().height + 12}px` : '0px',
      );
      column.style.setProperty(
        '--chat-composer-height',
        `${area.getBoundingClientRect().height}px`,
      );
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(chatScroll.syncLayout);
    };
    const resize = new ResizeObserver(update);
    resize.observe(area);
    // Keep the notice fixed while the chat scroller extends behind the toolbar.
    // Its measured space protects the first message and adapts to wrapped copy.
    const locateNotice = () => {
      const next = column.querySelector(':scope > .components-notice');
      if (next === notice) return;
      if (notice) resize.unobserve(notice);
      notice = next;
      if (notice) resize.observe(notice);
      update();
    };
    const changes = new MutationObserver(locateNotice);
    changes.observe(column, { childList: true, subtree: true });
    locateNotice();
    update();
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      changes.disconnect();
      column.style.removeProperty('--chat-composer-height');
      column.style.removeProperty('--chat-notice-space');
    };
  }, []);
  const [confirmInterview, setConfirmInterview] = useState(false);
  const [openingInterview, setOpeningInterview] = useState(false);
  const [testingAudio, setTestingAudio] = useState(false);
  const [interviewError, setInterviewError] = useState<string | null>(null);
  const [interviewDevices, setInterviewDevices] = useState<AudioDevice[]>([]);
  const [accessReport, setAccessReport] = useState<InterviewAccessReport | null>(null);
  const screenAccess = accessReport?.screenCapture;
  const screenReady = screenAccess && ['granted', 'not-required'].includes(screenAccess.status);
  const [checkingAccess, setCheckingAccess] = useState(false);
  const accessAttempt = useRef(0);
  const [interviewConfiguration, setInterviewConfiguration] = useState(
    defaultInterviewConfiguration,
  );
  const interviewSpeech = speechSelection(interviewConfiguration.options);
  const interviewProvider = useModelProvider(interviewConfiguration.modelId);
  const [infoOpen, setInfoOpen] = useState(false);
  const [panelWidth, setPanelWidth] = useState(380);
  const [resizingInfo, setResizingInfo] = useState(false);
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
  const resizeInfo = useRef<{ x: number; width: number } | null>(null);
  const resizePanel = (width: number) => {
    const maximum = Math.min(640, Math.max(300, (layoutRef.current?.clientWidth ?? 960) - 280));
    setPanelWidth(Math.round(Math.max(300, Math.min(maximum, width))));
  };
  useEffect(() => {
    const finish = () => {
      resizeInfo.current = null;
      setResizingInfo(false);
    };
    window.addEventListener('blur', finish);
    return () => window.removeEventListener('blur', finish);
  }, []);
  useEffect(() => {
    if (!infoOpen) {
      resizeInfo.current = null;
      setResizingInfo(false);
    }
  }, [infoOpen]);
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
  const beginInterview = () => {
    if (!componentReady(selectedSpeechComponent)) return;
    if (state.selectedKnowledgeBaseId && !componentReady('rag')) {
      setInterviewError(`请先下载并准备已选择的${componentPresentation.rag.label}，再开始面试。`);
      return;
    }
    setInterviewError(null);
    const configuration = resolveInterviewConfiguration(
      interviewSettings.configuration,
      connection.models,
      connection.live,
    );
    configuration.profile = structuredClone(state.info);
    configuration.knowledgeBaseId = state.selectedKnowledgeBaseId;
    setInterviewDevices([]);
    setInterviewConfiguration(configuration);
    setConfirmInterview(true);
    void checkAccess(configuration);
  };
  const audioName = (source: 'system' | 'microphone') => {
    if (!interviewConfiguration.options.sources.includes(source)) return t('不使用麦克风');
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
      disabled={!state.chatsReady || state.streaming || connection.loading}
      onAction={(action) => {
        if (action === 'profile') {
          state.dismissSkillUpdate();
          openInfo();
          return;
        }
        if (action === 'interview') {
          state.dismissSkillUpdate();
          if (!speechReady || (!!state.selectedKnowledgeBaseId && !ragReady))
            onComponentSettings?.();
          else beginInterview();
          return;
        }
        if (action === 'skills') {
          if (!connection.live) onAISettings?.();
          else void state.generateSkills();
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
  const checkAccess = async (configuration: InterviewConfiguration) => {
    const attempt = ++accessAttempt.current;
    setCheckingAccess(true);
    setAccessReport(null);
    setInterviewError(null);
    try {
      if (configuration.knowledgeBaseId) {
        const selectedBase = (await localKnowledge.listBases()).find(
          (base) => base.id === configuration.knowledgeBaseId,
        );
        if (attempt !== accessAttempt.current) return;
        if (!selectedBase) throw Error('所选面试知识库已删除，请在个人信息中重新选择。');
        setInterviewKnowledgeName(selectedBase.name);
      } else setInterviewKnowledgeName('不使用知识库');
      const report = await window.desktop!.checkInterviewAccess(configuration);
      if (attempt !== accessAttempt.current) return;
      setAccessReport(report);
      setInterviewDevices(report.devices);
    } catch (error) {
      if (attempt === accessAttempt.current)
        setInterviewError(
          error instanceof Error ? error.message : '无法检查面试权限，请重新检查。',
        );
    } finally {
      if (attempt === accessAttempt.current) setCheckingAccess(false);
    }
  };
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
            <Person size={15} />
            {t('个人信息')}
          </Button>
          <Button
            className="interview-start-trigger"
            disabled={
              !window.desktop ||
              openingInterview ||
              !speechReady ||
              (!!state.selectedKnowledgeBaseId && !ragReady) ||
              !connection.live ||
              connection.loading ||
              !connection.models.length
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
                {t('音频仅在本机处理，不保存。')}
                {interviewConfiguration.mode === 'local' &&
                  interviewConfiguration.aiEnabled &&
                  t(' 回答所需文字与资料会发送至 {0}。', [interviewProvider.dataRecipient])}
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
                    testingAudio ||
                    checkingAccess ||
                    !accessReport?.ready ||
                    !interviewConfiguration.modelId
                  }
                  onClick={async () => {
                    if (!window.desktop || openingInterview) return;
                    setOpeningInterview(true);
                    try {
                      await window.desktop.openInterview({
                        ...interviewConfiguration,
                        ...(interviewConfiguration.knowledgeBaseId
                          ? { knowledgeBaseName: interviewKnowledgeName }
                          : {}),
                      });
                      setConfirmInterview(false);
                    } catch (error) {
                      setAccessReport(null);
                      setInterviewError(userError(error, '面试窗口打开失败，请重试。'));
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
          <dl className="interview-start-summary" aria-label={t('当前面试设置')}>
            <div className="interview-start-knowledge">
              <dt>{t('面试知识库')}</dt>
              <dd>{state.selectedKnowledgeBaseId ? interviewKnowledgeName : t('不使用知识库')}</dd>
            </div>
            <div>
              <dt>{t('AI 服务剩余用量')}</dt>
              <dd>
                {!connection.live
                  ? t('未连接 AI 服务')
                  : connection.loadingUsage
                    ? t('正在读取…')
                    : accountUsageSummary(connection.usage)}
              </dd>
            </div>
            <div>
              <dt>{t('面试官 · 系统音频')}</dt>
              <dd>{audioName('system')}</dd>
            </div>
            <div>
              <dt>{t('面试者 · 麦克风')}</dt>
              <dd>{audioName('microphone')}</dd>
            </div>
            <div>
              <dt>{t('语音模型')}</dt>
              <dd>{t(speechModelLabels[interviewSpeech.speechModel])}</dd>
            </div>
            <div>
              <dt>{t('推理设备')}</dt>
              <dd>{t(inferenceDeviceLabels[interviewSpeech.inferenceDevice])}</dd>
            </div>
            <div>
              <dt>{t('回答模型')}</dt>
              <dd>
                {interviewConfiguration.aiEnabled
                  ? (connection.models.find((model) => model.id === interviewConfiguration.modelId)
                      ?.label ?? interviewConfiguration.modelId)
                  : t('未选择模型')}
              </dd>
            </div>
            <div>
              <dt>{t('思考强度')}</dt>
              <dd>{t(effortLabels[interviewConfiguration.effort])}</dd>
            </div>
          </dl>
          <section
            className="interview-access"
            aria-label={t('权限与设备检查')}
            aria-busy={checkingAccess}
          >
            <h3>{t('设备与权限')}</h3>
            {checkingAccess ? (
              <p className="interview-access-detail" role="status">
                {t('正在检查权限与音频设备…')}
              </p>
            ) : (
              <AudioCheck
                options={interviewConfiguration.options}
                disabled={openingInterview || checkingAccess}
                onBusyChange={setTestingAudio}
              >
                {({ button, result }) => (
                  <ul className="interview-access-list">
                    {accessReport?.checks.map((check) => (
                      <li key={check.source}>
                        <div className="interview-access-row">
                          <span>{check.source === 'microphone' ? t('麦克风') : t('系统音频')}</span>
                          <div className="interview-access-controls">
                            <span
                              className={`interview-access-status ${check.status === 'granted' ? '' : 'danger-text'}`}
                            >
                              {check.status === 'granted' ? <Check size={14} /> : <X size={14} />}
                              {t(audioAccessLabels[check.status])}
                            </span>
                            {button(check.source, check.status === 'granted')}
                          </div>
                        </div>
                        {result(check.source)}
                        {check.status !== 'granted' && (
                          <p className="interview-access-detail danger-text">{t(check.message)}</p>
                        )}
                      </li>
                    ))}
                    {screenAccess && (
                      <li aria-label={t('屏幕捕获权限检查')}>
                        <div className="interview-access-row">
                          <span>{t('屏幕截图')}</span>
                          <span className="interview-access-status">
                            {screenReady ? <Check size={14} /> : <Monitor size={14} />}
                            {t(screenAccessLabels[screenAccess.status])}
                          </span>
                        </div>
                        {!screenReady && (
                          <p className="interview-access-detail">
                            {['error', 'unknown', 'restricted'].includes(screenAccess.status) &&
                              `${t(screenAccess.message)} `}
                            {t('可继续纯语音面试，截图需授权。')}
                          </p>
                        )}
                      </li>
                    )}
                  </ul>
                )}
              </AudioCheck>
            )}
            <div className="interview-access-actions">
              <Button
                variant="ghost"
                style={{ width: startActionWidth, paddingInline: 8 }}
                disabled={openingInterview || checkingAccess || testingAudio}
                onClick={() => void checkAccess(interviewConfiguration)}
              >
                <Refresh size={16} />
                {t('重新检查')}
              </Button>
              {!checkingAccess &&
                accessReport?.checks.some(
                  (check) =>
                    (check.source === 'microphone' && check.status === 'denied') ||
                    (window.desktop?.platform === 'macos' &&
                      check.source === 'system' &&
                      check.status !== 'granted'),
                ) && (
                  <Button
                    variant="outline"
                    onClick={() =>
                      void window
                        .desktop!.openMicrophoneSettings(
                          window.desktop?.platform === 'macos'
                            ? accessReport?.checks.find((check) => check.status !== 'granted')
                                ?.source
                            : undefined,
                        )
                        .catch(() =>
                          setInterviewError('无法打开系统设置，请手动打开音频隐私设置。'),
                        )
                    }
                  >
                    <Settings size={16} />
                    {window.desktop?.platform === 'macos'
                      ? t('打开音频权限设置')
                      : t('打开麦克风权限设置')}
                  </Button>
                )}
            </div>
          </section>
          {interviewError && (
            <p role="alert" className="danger-text">
              {t(interviewError)}
            </p>
          )}
        </Modal>
      )}
      <div
        ref={layoutRef}
        className={`preparation-layout${infoOpen ? ' has-personal-info' : ''}${resizingInfo ? ' is-resizing-info' : ''}`}
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
          <ComponentsNotice
            onSettings={onComponentSettings}
            onPerformanceSettings={onSpeechSettings}
            speechOptions={interviewSettings.configuration.options}
          />
          {state.messages.length ? (
            <div
              className="chat-scroll"
              {...chatScroll.scrollProps}
              tabIndex={0}
              aria-label={t('聊天内容')}
            >
              <div className="chat-thread">
                {state.messages.map((message) => (
                  <article key={message.id} className={`chat-message ${message.role}`}>
                    {message.role === 'user' ? (
                      <div className="user-bubble">
                        <p>{message.content}</p>
                        {message.options && (
                          <div className="message-options">
                            <span>
                              {message.options.modelLabel || message.options.modelId}
                              {message.options.effort
                                ? t(' · 思考：{0}', [t(effortLabels[message.options.effort])])
                                : ''}
                            </span>
                            {message.options.attachments.map((item) => (
                              <span key={item.id}>
                                {t('附件：')}
                                {item.name}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    ) : (
                      <>
                        <div className="answer-label">
                          <ProviderIdentity
                            provider={
                              message.provider ?? (message.mode === 'live' ? 'unknown' : 'mock')
                            }
                            detail={
                              message.status === 'failed'
                                ? message.errorCode?.startsWith('skill_')
                                  ? t('提案校验失败')
                                  : t('回答未完成')
                                : message.status === 'stopped'
                                  ? t('已停止')
                                  : undefined
                            }
                          />
                        </div>
                        <ResponseProgress message={message} />
                        <ChatSources sources={message.sources ?? []} />
                        <div className="chat-answer">
                          {message.content ? (
                            <MarkdownContent content={message.content} />
                          ) : message.status === 'failed' ? (
                            t('请求失败，未收到回答。')
                          ) : message.status === 'stopped' ? (
                            t('已停止回复。')
                          ) : message.status === 'completed' ? (
                            t('服务未返回文本内容。')
                          ) : null}
                        </div>
                        <ProfileProposal message={message} />
                        {message.error && (
                          <p className="message-error" role="alert">
                            {t(message.error)}
                          </p>
                        )}
                        <div className="chat-message-actions">
                          {['failed', 'stopped'].includes(message.status ?? '') &&
                            message.id === state.messages.at(-1)?.id && (
                              <Button
                                variant="outline"
                                className="chat-retry"

                                disabled={state.streaming || !connection.models.length}
                                onClick={() => void state.retry(message.id)}
                              >
                                <Refresh size={16} />
                                {t('重试回答')}
                              </Button>
                            )}
                          {message.content && (
                            <Button
                              variant="ghost"
                              className="chat-copy"
                              onClick={async () => {
                                try {
                                  await navigator.clipboard.writeText(message.content);
                                  setCopied(message.id);
                                } catch {
                                  setCopied(null);
                                }
                              }}
                            >
                              {copied === message.id ? <Check size={13} /> : <Copy size={13} />}
                              {copied === message.id ? t('已复制') : t('复制')}
                            </Button>
                          )}
                        </div>
                      </>
                    )}
                  </article>
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
            {state.resume && (
              <div className="resume-chip">
                <MessageSquare size={14} />
                <span>{state.resume.name}</span>
                <small>{t('个人简历 · 保存在本机')}</small>
                <ConfirmDeleteButton
                  iconOnly
                  label={t('移除')}
                  target={t('简历原件：') + state.resume.name}
                  revision={state.resume.id}
                  aria-label={t('移除简历')}
                  warning={t('将删除保存的简历原件，摘要会保留')}
                  onConfirm={state.removeResume}
                />
              </div>
            )}
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
                              className="send-button"
                              type="button"
                              size="icon"
                              aria-label={t('停止回复')}
                              onClick={state.stop}
                            >
                              <Square size={18} />
                            </Button>
                          ) : (
                            <Button
                              className="send-button"
                              size="icon"
                              type="submit"
                              disabled={
                                !state.chatsReady ||
                                (!input.trim() && !state.attachments.length) ||
                                !connection.models.length
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
            {(visibleError || !connection.live) && (
              <p
                role={visibleError ? 'alert' : undefined}
                className={`simulation-disclaimer ${visibleError ? 'danger-text' : ''}`}
              >
                {t(visibleError || '请先连接模型服务。')}
              </p>
            )}
            {connection.error && (
              <Button
                variant="outline"
                disabled={connection.loading}
                onClick={() => void connection.load(true, true)}
              >
                <Refresh size={16} />
                {t('重新加载模型')}
              </Button>
            )}
            {state.chatStorageError && (
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
            )}
          </div>
        </div>
        <PersonalInfoPanel
          resizeHandle={
            infoOpen && (
              <div
                className="personal-resize-handle"
                role="separator"
                aria-label={t('调整个人信息宽度')}
                aria-orientation="vertical"
                tabIndex={0}
                aria-valuenow={panelWidth}
                aria-valuemin={300}
                aria-valuemax={640}
                onDoubleClick={() => setPanelWidth(380)}
                onKeyDown={(event) => {
                  if (event.key === 'Home') {
                    event.preventDefault();
                    setPanelWidth(380);
                  }
                  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                    event.preventDefault();
                    resizePanel(panelWidth + (event.key === 'ArrowLeft' ? 20 : -20));
                  }
                }}
                onPointerDown={(event) => {
                  if (event.button !== 0) return;
                  event.preventDefault();
                  event.currentTarget.setPointerCapture(event.pointerId);
                  resizeInfo.current = {
                    x: event.clientX,
                    width: event.currentTarget.parentElement!.getBoundingClientRect().width,
                  };
                  setResizingInfo(true);
                }}
                onPointerMove={(event) => {
                  const start = resizeInfo.current;
                  if (start) resizePanel(start.width + start.x - event.clientX);
                }}
                onPointerUp={(event) => {
                  resizeInfo.current = null;
                  setResizingInfo(false);
                  if (event.currentTarget.hasPointerCapture(event.pointerId))
                    event.currentTarget.releasePointerCapture(event.pointerId);
                }}
                onPointerCancel={() => {
                  resizeInfo.current = null;
                  setResizingInfo(false);
                }}
                onLostPointerCapture={() => {
                  resizeInfo.current = null;
                  setResizingInfo(false);
                }}
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

import { useTextareaSize } from './useTextareaSize';
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { componentReady, useComponentReady } from '../stores/components';
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
import { ProfileProposal, SkillUpdatePrompt } from './ProfileProposal';
import { MarkdownContent } from './MarkdownContent';
import { PlainTextContent } from './PlainTextContent';
import { isSkillReply } from '../services/preparation';
import { PersonalInfoPanel } from './PersonalInfoPanel';
import { FollowLatestButton } from './FollowLatestButton';
import { localKnowledge } from '../services/knowledge';
import { ProviderIdentity } from './ProviderIdentity';
import { ResponseProgress } from './ResponseProgress';
import { ChatSources } from './ChatSources';
import { readDroppedFiles, effortLabels } from '../services/chatOptions';
import { useChatConnection } from '../stores/chatConnection';
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
  onDraftChange,
}: {
  onComponentSettings?(): void;
  onSpeechSettings?(): void;
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
      document.querySelector<HTMLButtonElement>('[aria-label="个人信息"]')?.focus(),
    );
  };
  const askProfile = (prompt: string, uploadResume = false) => {
    state.setDraft([state.draft.trim(), prompt].filter(Boolean).join('\n\n'));
    setInfoOpen(false);
    requestAnimationFrame(() => {
      document.querySelector<HTMLTextAreaElement>('[aria-label="聊天消息"]')?.focus();
      if (uploadResume)
        document.querySelector<HTMLInputElement>('[aria-label="添加聊天文件"]')?.click();
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
      setInterviewError('请先下载并准备已选择的知识库模型，再开始面试。');
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
    if (!interviewConfiguration.options.sources.includes(source)) return '不使用麦克风';
    const id = interviewConfiguration.options[source];
    if (
      accessReport?.checks.some(
        (check) => check.source === source && check.status === 'unavailable',
      )
    )
      return `${id ? '所选' : '默认'}${source === 'system' ? '播放设备' : '麦克风'}不可用`;
    return (
      interviewDevices.find(
        (device) => device.source === source && (id ? device.id === id : device.default),
      )?.name ?? (source === 'system' ? '默认播放设备' : '默认麦克风')
    );
  };
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
          <strong>面试准备</strong>
        </div>
        <div className="toolbar-actions">
          <Button
            variant="ghost"
            aria-label="个人信息"
            aria-expanded={infoOpen}
            aria-controls="personal-info-panel"
            onClick={() => (infoOpen ? closeInfo() : openInfo())}
          >
            <Person size={15} />
            个人信息
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
            开始面试
          </Button>
        </div>
      </header>
      {confirmInterview && (
        <Modal
          title="开始面试"
          className="interview-start-dialog"
          subtitle="音频、模型和显示设置可在面试中调整。"
          footer={
            <>
              <p className="interview-start-description">
                音频仅在本机处理，不保存。
                {interviewConfiguration.mode === 'local' &&
                  interviewConfiguration.aiEnabled &&
                  ` 回答所需文字与资料会发送至 ${interviewProvider.dataRecipient}。`}
              </p>
              <div className="interview-start-actions">
                <Button
                  variant="outline"
                  data-autofocus
                  disabled={openingInterview}
                  onClick={() => {
                    ++accessAttempt.current;
                    setConfirmInterview(false);
                  }}
                >
                  <X size={16} />
                  取消
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
                      setInterviewError(
                        error instanceof Error ? error.message : '面试窗口打开失败，请重试。',
                      );
                    } finally {
                      setOpeningInterview(false);
                    }
                  }}
                >
                  <Play size={15} />
                  {openingInterview ? '正在打开…' : '确认开始'}
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
          <dl className="interview-start-summary" aria-label="当前面试设置">
            <div className="interview-start-knowledge">
              <dt>面试知识库</dt>
              <dd>{interviewKnowledgeName}</dd>
            </div>
            <div>
              <dt>面试官 · 系统音频</dt>
              <dd>{audioName('system')}</dd>
            </div>
            <div>
              <dt>面试者 · 麦克风</dt>
              <dd>{audioName('microphone')}</dd>
            </div>
            <div>
              <dt>语音模型</dt>
              <dd>{speechModelLabels[interviewSpeech.speechModel]}</dd>
            </div>
            <div>
              <dt>推理设备</dt>
              <dd>{inferenceDeviceLabels[interviewSpeech.inferenceDevice]}</dd>
            </div>
            <div>
              <dt>回答模型</dt>
              <dd>
                {interviewConfiguration.aiEnabled
                  ? (connection.models.find((model) => model.id === interviewConfiguration.modelId)
                      ?.label ?? interviewConfiguration.modelId)
                  : '未选择模型'}
              </dd>
            </div>
            <div>
              <dt>思考强度</dt>
              <dd>{effortLabels[interviewConfiguration.effort]}</dd>
            </div>
          </dl>
          <section
            className="interview-access"
            aria-label="权限与设备检查"
            aria-busy={checkingAccess}
          >
            <h3>设备与权限</h3>
            {checkingAccess ? (
              <p className="interview-access-detail" role="status">
                正在检查权限与音频设备…
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
                          <span>{check.source === 'microphone' ? '麦克风' : '系统音频'}</span>
                          <div className="interview-access-controls">
                            <span
                              className={`interview-access-status ${check.status === 'granted' ? '' : 'danger-text'}`}
                            >
                              {check.status === 'granted' ? <Check size={14} /> : <X size={14} />}
                              {audioAccessLabels[check.status]}
                            </span>
                            {button(check.source, check.status === 'granted')}
                          </div>
                        </div>
                        {result(check.source)}
                        {check.status !== 'granted' && (
                          <p className="interview-access-detail danger-text">{check.message}</p>
                        )}
                      </li>
                    ))}
                    {screenAccess && (
                      <li aria-label="屏幕捕获权限检查">
                        <div className="interview-access-row">
                          <span>屏幕截图</span>
                          <span className="interview-access-status">
                            {screenReady ? <Check size={14} /> : <Monitor size={14} />}
                            {screenAccessLabels[screenAccess.status]}
                          </span>
                        </div>
                        {!screenReady && (
                          <p className="interview-access-detail">
                            {['error', 'unknown', 'restricted'].includes(screenAccess.status) &&
                              `${screenAccess.message} `}
                            可继续纯语音面试，截图需授权。
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
                重新检查
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
                      ? '打开音频权限设置'
                      : '打开麦克风权限设置'}
                  </Button>
                )}
            </div>
          </section>
          {interviewError && (
            <p role="alert" className="danger-text">
              {interviewError}
            </p>
          )}
        </Modal>
      )}
      <div
        ref={layoutRef}
        className={`preparation-layout${infoOpen ? ' has-personal-info' : ''}${resizingInfo ? ' is-resizing-info' : ''}`}
        style={
          { '--personal-panel-width': `min(${panelWidth}px, calc(100% - 260px))` } as CSSProperties
        }
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
              <span>松开以添加文件到当前对话 · 最多 20 个，每个 20 MB</span>
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
              aria-label="聊天内容"
            >
              <div className="chat-thread">
                {state.messages.map((message, index) => (
                  <article key={message.id} className={`chat-message ${message.role}`}>
                    {message.role === 'user' ? (
                      <div className="user-bubble">
                        <p>{message.content}</p>
                        {message.options && (
                          <div className="message-options">
                            <span>
                              {message.options.modelLabel || message.options.modelId}
                              {message.options.effort
                                ? ` · 思考：${effortLabels[message.options.effort]}`
                                : ''}

                              {message.options.webSearch
                                ? message.options.live
                                  ? ' · 网络搜索'
                                  : ''
                                : ''}
                            </span>
                            {message.options.attachments.map((item) => (
                              <span key={item.id}>附件：{item.name}</span>
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
                                  ? '提案校验失败'
                                  : '回答未完成'
                                : message.status === 'stopped'
                                  ? '已停止'
                                  : undefined
                            }
                          />
                        </div>
                        <ResponseProgress message={message} />
                        {!isSkillReply(message, state.messages[index - 1]) && (
                          <ChatSources sources={message.sources ?? []} />
                        )}
                        {message.usage && (
                          <small className="answer-usage">
                            输入 {message.usage.inputTokens.toLocaleString()} · 输出{' '}
                            {message.usage.outputTokens.toLocaleString()} token
                          </small>
                        )}
                        <div className="chat-answer">
                          {message.content ? (
                            isSkillReply(message, state.messages[index - 1]) ? (
                              <PlainTextContent content={message.content} />
                            ) : (
                              <MarkdownContent content={message.content} />
                            )
                          ) : message.status === 'failed' ? (
                            '请求失败，未收到回答。'
                          ) : message.status === 'stopped' ? (
                            '已停止回复。'
                          ) : message.status === 'completed' ? (
                            '服务未返回文本内容。'
                          ) : null}
                        </div>
                        <ProfileProposal message={message} />
                        {message.error && (
                          <p className="message-error" role="alert">
                            {message.error}
                          </p>
                        )}
                        {['failed', 'stopped'].includes(message.status ?? '') &&
                          message.id === state.messages.at(-1)?.id && (
                            <Button
                              variant="outline"
                              className="chat-retry"

                              disabled={state.streaming || !connection.models.length}
                              onClick={() => void state.retry(message.id)}
                            >
                              <Refresh size={16} />
                              重试回答
                            </Button>
                          )}
                        {message.content && (
                          <Button
                            variant="ghost"
                            className="chat-copy"
                            onClick={async (event) => {
                              try {
                                const text = isSkillReply(message, state.messages[index - 1])
                                  ? (event.currentTarget
                                      .closest('article')
                                      ?.querySelector<HTMLElement>('.chat-answer')?.innerText ?? '')
                                  : message.content;
                                await navigator.clipboard.writeText(text);
                                setCopied(message.id);
                              } catch {
                                setCopied(null);
                              }
                            }}
                          >
                            {copied === message.id ? <Check size={13} /> : <Copy size={13} />}
                            {copied === message.id ? '已复制' : '复制'}
                          </Button>
                        )}
                      </>
                    )}
                  </article>
                ))}
                <SkillUpdatePrompt />
              </div>
            </div>
          ) : (
            <section className="welcome">
              <h1>今天想准备哪一部分面试？</h1>
              <SkillUpdatePrompt />
              <div className="suggestions">
                {[
                  {
                    label: '帮我准备自我介绍',
                    prompt:
                      '请根据已确认的简历，结合已有职位描述，写一份可直接口述的面试自我介绍。简要交代背景，重点突出与岗位相关的经历、个人贡献和能力，前后衔接自然，避免逐项复述简历。缺少职位描述时按现有简历完成；缺少的个人事实使用明确占位，不编造。',
                  },
                  {
                    label: '帮我梳理项目经历',
                    prompt:
                      '请根据已确认的简历，结合已有职位描述，梳理与岗位最相关的项目经历。按背景与目标、我的职责、关键方案及选择理由、难点处理、结果的顺序，整理成面试时便于讲述的内容。突出个人贡献，区分个人职责与团队成果；未提供的事实标注待补充，不虚构决策过程或量化数据。',
                  },
                  {
                    label: '上传我的简历',
                    prompt:
                      '请根据本次上传的简历整理摘要，保留教育与工作背景、职责、项目、关键技术和已有成果，准确区分个人贡献、团队成果及进行中事项。合并重复表述，不补造事实。仅提出简历摘要的待确认更新，不修改其他资料。',
                  },
                ].map(({ label, prompt }, index) => (
                  <button
                    key={label}
                    disabled={!state.chatsReady || state.streaming || !connection.models.length}
                    onClick={() =>
                      index === 2 ? askProfile(prompt, true) : void state.send(prompt)
                    }
                  >
                    {label}
                    <ArrowUp size={14} />
                  </button>
                ))}
              </div>
            </section>
          )}
          <div ref={composerArea} className="composer-area chat-composer">
            <FollowLatestButton
              visible={(state.streaming || !chatScroll.following) && state.messages.length > 0}
              label={chatScroll.hasNew ? '有新回复 · 返回最新' : '返回最新回复'}
              busy={state.streaming}
              onClick={chatScroll.scrollToLatest}
            />
            {state.resume && (
              <div className="resume-chip">
                <MessageSquare size={14} />
                <span>{state.resume.name}</span>
                <small>个人简历 · 保存在本机</small>
                <ConfirmDeleteButton
                  iconOnly
                  label="移除"
                  target={'简历原件：' + state.resume.name}
                  revision={state.resume.id}
                  aria-label="移除简历"
                  warning="将删除保存的简历原件，摘要会保留"
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
                  aria-label="聊天消息"
                  placeholder="询问面试准备问题，或告诉我你的目标岗位…"
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
                              aria-label="停止回复"
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
                              aria-label="发送消息"
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
                {visibleError || '请先连接模型服务。'}
              </p>
            )}
            {connection.error && (
              <Button
                variant="outline"
                disabled={connection.loading}
                onClick={() => void connection.load(true, true)}
              >
                <Refresh size={16} />
                重新加载模型
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
                {state.chatsReady ? '重试保存聊天' : '重新读取聊天'}
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
                aria-label="调整个人信息宽度"
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

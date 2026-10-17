import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  ArrowUp,
  Check,
  Copy,
  MessageSquare,
  Square,
  X,
  Person,
  Play,
  ChevronDown,
  Monitor,
} from './icons';
import { Button } from './ui/button';
import { ConfirmDeleteButton } from './ui/confirm-delete-button';
import { usePreparation } from '../stores/preparation';
import { ChatTools, ChatAttachments } from './ChatTools';
import { VoiceInputButton } from './VoiceInputButton';
import { useFollowScroll } from './useFollowScroll';
import { defaultInterviewConfiguration, resolveInterviewConfiguration } from '../services/speech';
import type {
  AudioDevice,
  InterviewAccessReport,
  InterviewConfiguration,
} from '../../electron/contracts/speech';
import { useInterviewSettings } from '../stores/interviewSettings';
import { useDictation } from '../stores/dictation';
import { Modal } from './ui/modal';
import { ProfileProposal } from './ProfileProposal';
import { MarkdownContent } from './MarkdownContent';
import { PersonalInfoPanel } from './PersonalInfoPanel';
import { localKnowledge } from '../services/knowledge';
import { ProviderIdentity } from './ProviderIdentity';
import { ResponseProgress } from './ResponseProgress';
import { ChatSources } from './ChatSources';
import { readDroppedFiles, effortLabels } from '../services/chatOptions';
import { useChatConnection } from '../stores/chatConnection';
import { useModelProvider } from './useModelProvider';
export function PreparationPage({
  onInterviewSettings,
  startRequest = 0,
  onDraftChange,
}: {
  onInterviewSettings?(): void;
  startRequest?: number;
  onDraftChange?(dirty: boolean): void;
}) {
  const state = usePreparation();
  const connection = useChatConnection();
  const provider = useModelProvider();
  const interviewSettings = useInterviewSettings();
  const chatScroll = useFollowScroll(state.messages, state.activeConversation);
  const dictation = useDictation();
  const dictating = dictation.phase !== 'idle';
  const input = state.draft;
  const setInput = state.setDraft;
  const inputRef = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const element = inputRef.current;
    if (!element) return;
    const resize = () => {
      const line = parseFloat(getComputedStyle(element).lineHeight);
      if (!Number.isFinite(line)) return;
      element.style.height = 'auto';
      element.style.overflowY = 'hidden';
      const height = Math.max(line * 2, Math.min(element.scrollHeight, line * 11));
      element.style.height = `${height}px`;
      element.style.overflowY = element.scrollHeight > height + 1 ? 'auto' : 'hidden';
    };
    resize();
    let width = element.clientWidth;
    const observer = new ResizeObserver(() => {
      if (element.clientWidth === width) return;
      width = element.clientWidth;
      resize();
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [input, state.activeConversation]);
  const [confirmInterview, setConfirmInterview] = useState(false);
  const [openingInterview, setOpeningInterview] = useState(false);
  const [interviewError, setInterviewError] = useState<string | null>(null);
  const [interviewDevices, setInterviewDevices] = useState<AudioDevice[]>([]);
  const [accessReport, setAccessReport] = useState<InterviewAccessReport | null>(null);
  const [checkingAccess, setCheckingAccess] = useState(false);
  const accessAttempt = useRef(0);
  const [interviewConfiguration, setInterviewConfiguration] = useState(
    defaultInterviewConfiguration,
  );
  const interviewProvider = useModelProvider(interviewConfiguration.modelId);
  const [infoOpen, setInfoOpen] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const visibleError =
    state.chatStorageError ||
    dictation.error ||
    connection.error ||
    (state.error &&
    !state.messages.some((message) => message.error === state.error) &&
    !(infoOpen && profileError === state.error)
      ? state.error
      : null);
  const [copied, setCopied] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
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
    if ((!input.trim() && !state.attachments.length) || state.streaming || dictating) return;
    const text = input;
    void state.send(text);
  };
  const beginInterview = () => {
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
  useEffect(() => {
    if (startRequest) beginInterview();
  }, [startRequest]);
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
    <main className="workspace preparation-workspace">
      <header className="page-toolbar">
        <div className="breadcrumb">
          <strong>面试准备</strong>
        </div>
        <div className="toolbar-actions">
          <Button
            variant="ghost"
            aria-label="个人信息"
            aria-expanded={infoOpen}
            onClick={() => (infoOpen ? closeInfo() : openInfo())}
          >
            <Person size={15} />
            个人信息
          </Button>
          <Button
            disabled={
              !window.desktop ||
              openingInterview ||
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
          icon={<Play size={20} />}
          subtitle="请核对当前面试设置。"
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
          <p className="interview-start-settings-hint">
            <Button
              variant="ghost"
              disabled={openingInterview}
              onClick={() => {
                ++accessAttempt.current;
                setConfirmInterview(false);
                onInterviewSettings?.();
              }}
            >
              前往面试设置
            </Button>
            <span>保存后返回此处重新核对。</span>
          </p>
          <div className="interview-access" aria-label="权限与设备检查">
            {checkingAccess ? (
              <p role="status">正在检查权限与音频设备…</p>
            ) : (
              accessReport?.checks.map((check) => (
                <p key={check.source} className={check.status === 'granted' ? '' : 'danger-text'}>
                  <span className="interview-access-icon" aria-hidden="true">
                    {check.status === 'granted' ? <Check size={14} /> : <X size={14} />}
                  </span>
                  <span>{check.message}</span>
                </p>
              ))
            )}
            {!checkingAccess && accessReport?.screenCapture && (
              <p aria-label="屏幕捕获权限检查">
                <span className="interview-access-icon" aria-hidden="true">
                  {['granted', 'not-required'].includes(accessReport.screenCapture.status) ? (
                    <Check size={14} />
                  ) : (
                    <Monitor size={14} />
                  )}
                </span>
                <span>
                  {accessReport.screenCapture.message}
                  {!['granted', 'not-required'].includes(accessReport.screenCapture.status) &&
                    '；可继续纯语音面试，截图功能需授权。'}
                </span>
              </p>
            )}
            {!checkingAccess &&
              (!accessReport?.ready ||
                interviewError ||
                (accessReport?.screenCapture &&
                  !['granted', 'not-required'].includes(accessReport.screenCapture.status))) && (
                <div className="interview-access-actions">
                  <Button
                    variant="ghost"
                    disabled={openingInterview}
                    onClick={() => void checkAccess(interviewConfiguration)}
                  >
                    重新检查
                  </Button>
                  {accessReport?.checks.some(
                    (check) =>
                      (check.source === 'microphone' && check.status === 'denied') ||
                      (window.desktop?.nativeWindowControls === true &&
                        check.source === 'system' &&
                        check.status !== 'granted'),
                  ) && (
                    <Button
                      variant="outline"
                      onClick={() =>
                        void window
                          .desktop!.openMicrophoneSettings(
                            window.desktop?.nativeWindowControls
                              ? accessReport?.checks.find((check) => check.status !== 'granted')
                                  ?.source
                              : undefined,
                          )
                          .catch(() =>
                            setInterviewError('无法打开系统设置，请手动打开音频隐私设置。'),
                          )
                      }
                    >
                      {window.desktop?.nativeWindowControls
                        ? '打开音频权限设置'
                        : '打开麦克风权限设置'}
                    </Button>
                  )}
                </div>
              )}
          </div>
          <p className="interview-start-description">
            音频仅在本机处理，不保存。
            {interviewConfiguration.mode === 'local' &&
              interviewConfiguration.aiEnabled &&
              ` 回答会将必要的本场问题、追问、你的回答文字和相关资料片段发送至 ${interviewProvider.dataRecipient}；结束后仅使用问题生成标题。`}
          </p>
          {interviewError && (
            <p role="alert" className="danger-text">
              {interviewError}
            </p>
          )}
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
              取消
            </Button>
            <Button
              disabled={
                openingInterview ||
                checkingAccess ||
                !accessReport?.ready ||
                !interviewConfiguration.modelId
              }
              onClick={async () => {
                if (!window.desktop || openingInterview) return;
                setOpeningInterview(true);
                try {
                  await window.desktop.openInterview(interviewConfiguration);
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
        </Modal>
      )}
      <div className="preparation-layout">
        <div className="chat-column">
          {state.messages.length ? (
            <div
              className="chat-scroll"
              {...chatScroll.scrollProps}
              tabIndex={0}
              aria-label="聊天内容"
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
                        <ChatSources sources={message.sources ?? []} />
                        {message.usage && (
                          <small className="answer-usage">
                            输入 {message.usage.inputTokens.toLocaleString()} · 输出{' '}
                            {message.usage.outputTokens.toLocaleString()} token
                          </small>
                        )}
                        <div className="chat-answer">
                          {message.content ? (
                            <MarkdownContent content={message.content} />
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
                              disabled={state.streaming || dictating || !connection.models.length}
                              onClick={() => void state.retry(message.id)}
                            >
                              重试回答
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
                            {copied === message.id ? '已复制' : '复制'}
                          </Button>
                        )}
                      </>
                    )}
                  </article>
                ))}
              </div>
            </div>
          ) : (
            <section className="welcome">
              <h1>今天想准备哪一部分面试？</h1>
              <div className="suggestions">
                {['帮我准备自我介绍', '帮我梳理项目经历', '上传我的简历'].map((label, index) => (
                  <button
                    key={label}
                    disabled={!state.chatsReady || state.streaming || !connection.models.length}
                    onClick={() =>
                      index === 2
                        ? askProfile('请根据我上传的简历生成简历摘要，先展示待确认内容。', true)
                        : void state.send(label)
                    }
                  >
                    {label}
                    <ArrowUp size={14} />
                  </button>
                ))}
              </div>
            </section>
          )}
          <div className="composer-area chat-composer">
            {!chatScroll.following && state.messages.length > 0 && (
              <Button
                className="follow-latest"
                variant="outline"
                onClick={chatScroll.scrollToLatest}
              >
                <ChevronDown size={15} />
                {chatScroll.hasNew ? '有新回复 · 返回最新' : '返回最新回复'}
              </Button>
            )}
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
            <form
              className={`composer ${dragging ? 'composer-dragging' : ''}`}
              onDragEnter={(event) => {
                event.preventDefault();
                if (event.dataTransfer.types.includes('Files')) {
                  dragDepth.current++;
                  setDragging(true);
                }
              }}
              onDragOver={(event) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = 'copy';
              }}
              onDragLeave={(event) => {
                event.preventDefault();
                dragDepth.current = Math.max(0, dragDepth.current - 1);
                if (!dragDepth.current) setDragging(false);
              }}
              onDrop={(event) => {
                event.preventDefault();
                if (!state.chatsReady) return;
                dragDepth.current = 0;
                setDragging(false);
                void readDroppedFiles(event.dataTransfer)
                  .then(state.addAttachments)
                  .catch((error) =>
                    usePreparation.setState({
                      error: error instanceof Error ? error.message : '读取文件失败。',
                    }),
                  );
              }}
              onSubmit={(event) => {
                event.preventDefault();
                submit();
              }}
            >
              {dragging && (
                <div className="composer-drop-hint">松开以添加文件 · 最多 20 个，每个 20 MB</div>
              )}
              <ChatAttachments />
              <textarea
                ref={inputRef}
                disabled={!state.chatsReady}
                aria-label="聊天消息"
                placeholder="询问面试准备问题，或告诉我你的目标岗位…"
                value={input}
                readOnly={dictating}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    submit();
                  }
                }}
                rows={2}
              />
              <div className="composer-bottom">
                <div className="composer-tools">
                  <ChatTools />
                </div>
                <div className="composer-actions">
                  <VoiceInputButton
                    value={input}
                    onChange={setInput}
                    disabled={state.streaming || !state.chatsReady}
                    contextKey={state.activeConversation}
                  />
                  {state.streaming ? (
                    <Button type="button" size="icon" aria-label="停止回复" onClick={state.stop}>
                      <Square size={13} />
                    </Button>
                  ) : (
                    <Button
                      className="send-button"
                      size="icon"
                      type="submit"
                      disabled={
                        !state.chatsReady ||
                        dictating ||
                        (!input.trim() && !state.attachments.length) ||
                        !connection.models.length
                      }
                      aria-label="发送消息"
                    >
                      <ArrowUp size={20} />
                    </Button>
                  )}
                </div>
              </div>
            </form>
            <p
              role={visibleError ? 'alert' : undefined}
              className={`simulation-disclaimer ${visibleError ? 'danger-text' : ''}`}
            >
              {visibleError ||
                (connection.live
                  ? `聊天、个人资料、主动添加的附件和相关资料片段将发送至 ${provider.dataRecipient}。请核实重要信息。`
                  : '请先连接模型服务。')}
            </p>
            {connection.error && (
              <Button
                variant="outline"
                disabled={connection.loading}
                onClick={() => void connection.load(true, true)}
              >
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
                {state.chatsReady ? '重试保存聊天' : '重新读取聊天'}
              </Button>
            )}
          </div>
        </div>
        <PersonalInfoPanel
          open={infoOpen}
          onClose={closeInfo}
          onDirtyChange={onDraftChange}
          onErrorChange={setProfileError}
        />
      </div>
    </main>
  );
}

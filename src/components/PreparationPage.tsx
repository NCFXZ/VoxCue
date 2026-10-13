import { useEffect, useRef, useState } from 'react';
import { ArrowUp, Check, Copy, MessageSquare, Square, X, Settings, Play } from './icons';
import { Button } from './ui/button';
import { usePreparation } from '../stores/preparation';
import type { PersonalInfo } from '../services/preparation';
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
import { AnswerStylePanel } from './AnswerStylePanel';
import { ProviderIdentity } from './ProviderIdentity';
import { ChatActivity, describeActivity } from './ChatActivity';
import { readDroppedFiles, effortLabels } from '../services/chatOptions';
import { useChatConnection } from '../stores/chatConnection';
import { openChatLink } from '../services/chat';
export function PreparationPage() {
  const state = usePreparation();
  const connection = useChatConnection();
  const interviewSettings = useInterviewSettings();
  const chatScroll = useFollowScroll(state.messages, state.activeConversation);
  const dictation = useDictation();
  const dictating = dictation.phase !== 'idle';
  const [input, setInput] = useState('');
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
  const [infoOpen, setInfoOpen] = useState(false);
  const [draft, setDraft] = useState<PersonalInfo>(state.info);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const file = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void state.load();
  }, []);

  useEffect(() => {
    setDraft(state.info);
  }, [state.info]);
  const openInfo = () => {
    setDraft(state.info);
    setInfoOpen(true);
    setSaved(false);
  };
  const submit = () => {
    if ((!input.trim() && !state.attachments.length) || state.streaming || dictating) return;
    const text = input;
    setInput('');
    void state.send(text);
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
  return (
    <main className="workspace preparation-workspace">
      <header className="page-toolbar">
        <div className="breadcrumb">
          工作空间<span>/</span>
          <strong>面试准备</strong>
        </div>
        <div className="toolbar-actions">
          <Button
            variant="ghost"
            aria-expanded={infoOpen}
            onClick={() => (infoOpen ? setInfoOpen(false) : openInfo())}
          >
            <Settings size={15} />
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
            title="确认本场设置并开始面试"
            onClick={() => {
              setInterviewError(null);
              const configuration = resolveInterviewConfiguration(
                interviewSettings.configuration,
                connection.models,
                connection.live,
              );
              setInterviewDevices([]);
              setInterviewConfiguration(configuration);
              setConfirmInterview(true);
              void checkAccess(configuration);
            }}
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
            如需修改，请取消并前往「设置 → 面试设置」调整。
          </p>
          <div className="interview-access" aria-label="权限与设备检查">
            {checkingAccess ? (
              <p role="status">正在检查权限与音频设备…</p>
            ) : (
              accessReport?.checks.map((check) => (
                <p key={check.source} className={check.status === 'granted' ? '' : 'danger-text'}>
                  {check.status === 'granted' ? <Check size={14} /> : <X size={14} />}
                  {check.message}
                </p>
              ))
            )}
            {!checkingAccess && (!accessReport?.ready || interviewError) && (
              <div className="interview-access-actions">
                <Button
                  variant="ghost"
                  disabled={openingInterview}
                  onClick={() => void checkAccess(interviewConfiguration)}
                >
                  重新检查
                </Button>
                {accessReport?.checks.some(
                  (check) => check.source === 'microphone' && check.status === 'denied',
                ) && (
                  <Button
                    variant="outline"
                    onClick={() =>
                      void window
                        .desktop!.openMicrophoneSettings()
                        .catch(() =>
                          setInterviewError('无法打开 Windows 设置，请手动打开麦克风隐私设置。'),
                        )
                    }
                  >
                    打开麦克风权限设置
                  </Button>
                )}
              </div>
            )}
          </div>
          <p className="interview-start-description">
            音频仅在本机处理，不保存。
            {interviewConfiguration.mode === 'local' &&
              interviewConfiguration.aiEnabled &&
              ' 问题文字会发送至 OpenAI；面试结束后使用问题生成标题。'}
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
            <div className="chat-scroll" {...chatScroll} tabIndex={0}>
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
                              message.provider ?? (message.mode === 'live' ? 'chatgpt' : 'mock')
                            }
                            detail={
                              message.status === 'failed'
                                ? '回答未完成'
                                : message.status === 'stopped'
                                  ? '已停止'
                                  : undefined
                            }
                          />
                        </div>
                        {!!message.sources?.length && (
                          <div className="chat-sources" aria-label="搜索来源">
                            <span>来源</span>
                            {message.sources.map((source, index) => (
                              <button
                                key={source.url}
                                title={source.url}
                                onClick={() => {
                                  void openChatLink(source.url).catch(() =>
                                    usePreparation.setState({ error: '无法打开来源链接。' }),
                                  );
                                }}
                              >
                                {index + 1}. {source.title}
                              </button>
                            ))}
                          </div>
                        )}
                        {message.usage && (
                          <small className="answer-usage">
                            输入 {message.usage.inputTokens.toLocaleString()} · 输出{' '}
                            {message.usage.outputTokens.toLocaleString()} token
                          </small>
                        )}
                        {message.reasoningSummary && (
                          <details className="reasoning-summary">
                            <summary>
                              <span>推理摘要</span>
                              {message.status === 'streaming' && (
                                <span className="reasoning-phase">
                                  {describeActivity(message.activity)}
                                </span>
                              )}
                            </summary>
                            <MarkdownContent content={message.reasoningSummary} />
                          </details>
                        )}
                        {message.status === 'streaming' && !message.reasoningSummary && (
                          <ChatActivity
                            activity={message.activity}
                            mock={message.mode !== 'live'}
                          />
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
              <h1>有什么可以帮你？</h1>
              <div className="suggestions">
                {['帮我准备自我介绍', '帮我梳理项目经历', '上传我的简历'].map((label, index) => (
                  <button
                    key={label}
                    disabled={state.streaming || state.uploading || !connection.models.length}
                    onClick={() => (index === 2 ? file.current?.click() : void state.send(label))}
                  >
                    {label}
                    <ArrowUp size={14} />
                  </button>
                ))}
              </div>
            </section>
          )}
          <div className="composer-area chat-composer">
            {state.resume && (
              <div className="resume-chip">
                <MessageSquare size={14} />
                <span>{state.resume.name}</span>
                <small>已保存本地 · 未进行 AI 解析</small>
                <Button
                  disabled={state.uploading}
                  variant="dangerGhost"
                  size="icon"
                  aria-label="移除简历"
                  onClick={() => {
                    void state.removeResume();
                  }}
                >
                  <X size={13} />
                </Button>
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
                  <VoiceInputButton value={input} onChange={setInput} disabled={state.streaming} />
                  {state.streaming ? (
                    <Button type="button" size="icon" aria-label="停止回复" onClick={state.stop}>
                      <Square size={13} />
                    </Button>
                  ) : (
                    <Button
                      size="icon"
                      type="submit"
                      disabled={
                        dictating ||
                        (!input.trim() && !state.attachments.length) ||
                        !connection.models.length
                      }
                      aria-label="发送消息"
                    >
                      <ArrowUp size={18} />
                    </Button>
                  )}
                </div>
              </div>
            </form>
            <input
              className="sr-only"
              ref={file}
              type="file"
              accept=".pdf,.doc,.docx,.txt,.md"
              aria-label="上传简历文件"
              onChange={(event) => {
                const resume = event.target.files?.[0];
                if (resume) void state.uploadResume(resume);
                event.target.value = '';
              }}
            />
            <p
              role={state.error || dictation.error ? 'alert' : undefined}
              className={`simulation-disclaimer ${state.error || dictation.error ? 'danger-text' : ''}`}
            >
              {dictation.error ||
                state.error ||
                connection.error ||
                (connection.live
                  ? '聊天及主动添加的附件将发送至 OpenAI；回答可能出错，请核实重要信息。'
                  : '请先连接 ChatGPT。')}
            </p>
          </div>
        </div>
        {infoOpen && (
          <aside className="personal-panel">
            <header>
              <div>
                <p className="eyebrow">YOUR CONTEXT</p>
                <h2>个人信息</h2>
              </div>
              <Button
                variant="ghost"
                size="icon"
                aria-label="关闭个人信息"
                onClick={() => setInfoOpen(false)}
              >
                <X size={16} />
              </Button>
            </header>
            <p className="panel-description">
              补充你的背景，让面试准备更有方向。资料仅保存在本机。
            </p>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (state.updateInfo(draft)) setSaved(true);
              }}
            >
              <label className="field-label">
                姓名
                <input
                  value={draft.name}
                  maxLength={60}
                  placeholder="你的名字"
                  onChange={(event) => {
                    setDraft({ ...draft, name: event.target.value });
                    setSaved(false);
                  }}
                />
              </label>
              <label className="field-label">
                目标岗位
                <input
                  value={draft.role}
                  maxLength={100}
                  placeholder="例如：前端开发工程师"
                  onChange={(event) => {
                    setDraft({ ...draft, role: event.target.value });
                    setSaved(false);
                  }}
                />
              </label>
              <label className="field-label">
                个人背景
                <textarea
                  aria-label="个人背景"
                  value={draft.background}
                  maxLength={10000}
                  rows={5}
                  placeholder="教育背景、工作经历、擅长的技能…"
                  onChange={(event) => {
                    setDraft({ ...draft, background: event.target.value });
                    setSaved(false);
                  }}
                />
              </label>
              <label className="field-label">
                岗位描述 / JD
                <textarea
                  aria-label="岗位描述 / JD"
                  value={draft.jobDescription}
                  maxLength={10000}
                  rows={6}
                  placeholder="粘贴目标岗位的职责和要求…"
                  onChange={(event) => {
                    setDraft({ ...draft, jobDescription: event.target.value });
                    setSaved(false);
                  }}
                />
              </label>
              <Button type="submit">
                {saved ? (
                  <>
                    <Check size={14} />
                    已保存
                  </>
                ) : (
                  '保存信息'
                )}
              </Button>
            </form>
            <AnswerStylePanel />
            <div className="personal-resume">
              <strong>简历</strong>
              <p>{state.resume?.name || '尚未上传简历'}</p>
              <Button
                variant="outline"
                disabled={state.uploading}
                onClick={() => file.current?.click()}
              >
                {state.resume ? '替换简历' : '上传简历'}
              </Button>
              <small>最大 20 MB · 原件保存在本机</small>
            </div>
          </aside>
        )}
      </div>
    </main>
  );
}

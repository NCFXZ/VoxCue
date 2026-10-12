import { useEffect, useRef, useState } from 'react';
import { ArrowUp, Check, Copy, MessageSquare, Sparkles, Square, X, Settings } from './icons';
import { Button } from './ui/button';
import { usePreparation } from '../stores/preparation';
import type { PersonalInfo } from '../services/preparation';
import { ChatTools, ChatAttachments } from './ChatTools';
import { readDroppedFiles, effortLabels } from '../services/chatOptions';
import { useChatConnection } from '../stores/chatConnection';
import { openChatLink } from '../services/chat';
export function PreparationPage() {
  const state = usePreparation();
  const connection = useChatConnection();
  const [input, setInput] = useState('');
  const [infoOpen, setInfoOpen] = useState(false);
  const [draft, setDraft] = useState<PersonalInfo>(state.info);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const file = useRef<HTMLInputElement>(null);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    void state.load();
  }, []);
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'nearest' });
  }, [state.messages]);
  const openInfo = () => {
    setDraft(state.info);
    setInfoOpen(true);
    setSaved(false);
  };
  const submit = () => {
    if ((!input.trim() && !state.attachments.length) || state.streaming) return;
    const text = input;
    setInput('');
    void state.send(text);
  };
  return (
    <main className="workspace preparation-workspace">
      <header className="page-toolbar">
        <div className="breadcrumb">
          工作空间<span>/</span>
          <strong>面试准备</strong>
        </div>
        <div className="toolbar-actions">
          <span className="mock-badge">
            <span />
            {connection.live ? 'ChatGPT' : 'Mock 聊天'}
          </span>
          <Button
            variant="ghost"
            aria-expanded={infoOpen}
            onClick={() => (infoOpen ? setInfoOpen(false) : openInfo())}
          >
            <Settings size={15} />
            个人信息
          </Button>
          <Button
            disabled={!window.desktop}
            title="打开独立的 Mock 面试悬浮窗"
            onClick={() => {
              void window.desktop
                ?.openInterview()
                .catch(() => usePreparation.setState({ error: '面试窗口打开失败，请重试。' }));
            }}
          >
            开始面试
          </Button>
        </div>
      </header>
      <div className="preparation-layout">
        <div className="chat-column">
          {state.messages.length ? (
            <div className="chat-scroll">
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
                              {message.options.live ? '' : ' · Mock'}
                              {message.options.webSearch
                                ? message.options.live
                                  ? ' · 网络搜索'
                                  : ' · 网络搜索（模拟）'
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
                          <span className="ai-avatar">
                            <Sparkles size={14} />
                          </span>
                          <strong>Copilot</strong>
                          <span>
                            {message.mode === 'live'
                              ? message.status === 'failed'
                                ? '回答未完成'
                                : message.status === 'stopped'
                                  ? '已停止'
                                  : 'ChatGPT'
                              : '模拟回复'}
                          </span>
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
                        <div className="chat-answer">
                          {message.content ||
                            (message.status === 'failed'
                              ? '请求失败，未收到回答。'
                              : message.status === 'stopped'
                                ? '已停止回复。'
                                : message.status === 'completed'
                                  ? '服务未返回文本内容。'
                                  : '正在等待回答…')}
                          {state.streaming &&
                            message.id === state.messages[state.messages.length - 1]?.id && (
                              <span className="typing-caret" />
                            )}
                        </div>
                        {message.status === 'completed' &&
                          message.changes &&
                          Object.keys(message.changes).length > 0 && (
                            <div className="profile-proposal">
                              <strong>待确认的资料更新</strong>
                              {Object.entries(message.changes).map(([key, value]) => (
                                <p key={key}>
                                  <span>
                                    {
                                      (
                                        {
                                          name: '姓名',
                                          role: '目标岗位',
                                          jobDescription: '岗位描述',
                                          background: '个人背景',
                                        } as Record<string, string>
                                      )[key]
                                    }
                                  </span>
                                  {value}
                                </p>
                              ))}
                              <Button
                                variant="outline"
                                disabled={message.applied}
                                onClick={() => state.updateInfo(message.changes!, message.id)}
                              >
                                {message.applied ? (
                                  <>
                                    <Check size={13} />
                                    已更新
                                  </>
                                ) : (
                                  '确认更新'
                                )}
                              </Button>
                            </div>
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
                <div ref={end} />
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
            <div className="composer-caption">
              <span>
                <MessageSquare size={14} />
                准备对话
              </span>
              <span>中文 · 简体</span>
            </div>
            {state.resume && (
              <div className="resume-chip">
                <MessageSquare size={14} />
                <span>{state.resume.name}</span>
                <small>已保存本地 · 未进行 AI 解析</small>
                <Button
                  disabled={state.uploading}
                  variant="ghost"
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
                {state.streaming ? (
                  <Button type="button" size="icon" aria-label="停止回复" onClick={state.stop}>
                    <Square size={13} />
                  </Button>
                ) : (
                  <Button
                    size="icon"
                    type="submit"
                    disabled={
                      (!input.trim() && !state.attachments.length) || !connection.models.length
                    }
                    aria-label="发送消息"
                  >
                    <ArrowUp size={18} />
                  </Button>
                )}
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
              role={state.error ? 'alert' : undefined}
              className={`simulation-disclaimer ${state.error ? 'danger-text' : ''}`}
            >
              {state.error ||
                connection.error ||
                (connection.live
                  ? '聊天及主动添加的附件将发送至 OpenAI；回答可能出错，请核实重要信息。'
                  : '当前为 Mock 准备聊天，未接入真实 AI；聊天不会保存为面试记录。')}
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
              <small>最大 20 MB · 文档解析尚未接入</small>
            </div>
          </aside>
        )}
      </div>
    </main>
  );
}

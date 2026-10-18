import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useComponentReady } from '../stores/components';
import { ComponentsNotice } from './ComponentsNotice';
import { usePreparation } from '../stores/preparation';
import { localKnowledge, type KnowledgeBase } from '../services/knowledge';
import {
  profileLabels,
  profileProposalStale,
  type PersonalInfo,
  type ProfileChanges,
} from '../../electron/contracts/profile';
import { Button } from './ui/button';
import { ConfirmDeleteButton } from './ui/confirm-delete-button';
import { ChoiceMenu } from './ui/choice-menu';
import { Modal } from './ui/modal';
import { Check, X, Edit, ChevronRight, Save, Refresh } from './icons';
import { ProfileValue } from './ProfileProposal';
import { PlainTextContent } from './PlainTextContent';

const basicInfo = (info: PersonalInfo) => ({
  name: info.name,
  language: info.language || '简体中文',
});
export function PersonalInfoPanel({
  open,
  onClose,
  onDirtyChange,
  onErrorChange,
  onComponentSettings,
  resizeHandle,
}: {
  onComponentSettings?(): void;
  open: boolean;
  onClose(): void;
  onDirtyChange?(dirty: boolean): void;
  onErrorChange?(error: string | null): void;
  resizeHandle?: ReactNode;
}) {
  const state = usePreparation();
  const panelRef = useRef<HTMLElement>(null);
  const [basic, setBasic] = useState(() => basicInfo(state.info));
  const base = useRef(basicInfo(state.info));
  const dirty = JSON.stringify(basic) !== JSON.stringify(base.current);
  const conflict = JSON.stringify(basicInfo(state.info)) !== JSON.stringify(base.current);
  const [editor, setEditor] = useState<{
    field: 'background' | 'jobDescription' | 'customInstructions' | 'skills';
    text: string;
    id?: string;
    title?: string;
    base: PersonalInfo;
  } | null>(null);
  const edit = (
    field: 'background' | 'jobDescription' | 'customInstructions' | 'skills',
    id?: string,
  ) => {
    const skill =
      field === 'skills' ? state.info.skills?.find((item) => item.id === id) : undefined;
    setEditor({
      base: structuredClone(state.info),
      field,
      id,
      text: field === 'skills' ? skill?.content || '' : state.info[field] || '',
      title: skill?.title,
    });
    setError(null);
  };
  const submitEdit = () => {
    if (!editor) return;
    const changes: ProfileChanges =
      editor.field === 'skills'
        ? {
            skills: (state.info.skills ?? []).map((item) =>
              item.id === editor.id
                ? { ...item, title: editor.title || '', content: editor.text }
                : item,
            ),
          }
        : { [editor.field]: editor.text };
    if (profileProposalStale(state.info, editor.base, changes)) {
      setError('资料已有更新，请取消后重新编辑，避免覆盖新内容。');
      return;
    }
    if (state.updateInfo(changes)) {
      setEditor(null);
      setError(null);
    } else setError(usePreparation.getState().error);
  };
  const ragReady = useComponentReady('rag');
  const [error, setError] = useState<string | null>(null);
  const [bases, setBases] = useState<KnowledgeBase[]>([]);
  const [basesError, setBasesError] = useState<string | null>(null);
  const [loadedBases, setLoadedBases] = useState(false);
  useEffect(() => {
    if (JSON.stringify(basic) === JSON.stringify(base.current)) {
      const next = basicInfo(state.info);
      base.current = next;
      setBasic(next);
    }
  }, [state.info]);
  useEffect(() => {
    onDirtyChange?.(dirty || !!editor);
  }, [dirty, editor, onDirtyChange]);
  useEffect(() => {
    onErrorChange?.(error);
  }, [error, onErrorChange]);
  useEffect(() => {
    if (!open) return;
    let active = true;
    const load = () =>
      void localKnowledge
        .listBases()
        .then((value) => {
          if (active) {
            setBases(value.filter((item) => item.id !== 'personal-resume'));
            setLoadedBases(true);
            setBasesError(null);
          }
        })
        .catch(() => {
          if (active) setBasesError('无法读取知识库列表，请重试。');
        });
    load();
    window.addEventListener('focus', load);
    return () => {
      active = false;
      window.removeEventListener('focus', load);
    };
  }, [open]);
  const selectedMissing =
    loadedBases &&
    !!state.selectedKnowledgeBaseId &&
    !bases.some((item) => item.id === state.selectedKnowledgeBaseId);
  const languages = [
    '简体中文',
    'English',
    ...(!['简体中文', 'English'].includes(basic.language) ? [basic.language] : []),
  ];
  const completed = [
    state.info.background,
    state.info.jobDescription,
    state.info.customInstructions?.length,
    state.selectedKnowledgeBaseId,
    state.info.skills?.length,
  ].filter(Boolean).length;
  const renderEditor = () =>
    open && editor ? (
      <Modal
        title={'编辑' + profileLabels[editor.field]}
        className="profile-edit-dialog"
        onClose={() => {
          setEditor(null);
          setError(null);
        }}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            submitEdit();
          }}
        >
          {editor!.field === 'skills' && (
            <label className="field-label">
              技能名称
              <input
                aria-label="技能名称"
                value={editor.title || ''}
                maxLength={80}
                onChange={(event) => setEditor({ ...editor, title: event.target.value })}
              />
            </label>
          )}
          <label className="field-label">
            {editor!.field === 'skills'
              ? '技能内容'
              : editor!.field === 'customInstructions'
                ? '自定义指令内容'
                : '内容'}
            <textarea
              data-autofocus
              aria-label={
                editor!.field === 'skills'
                  ? '技能内容'
                  : editor!.field === 'customInstructions'
                    ? '自定义指令内容'
                    : '内容'
              }
              className="profile-editor-input"
              rows={6}
              maxLength={
                editor!.field === 'skills'
                  ? 6000
                  : editor!.field === 'customInstructions'
                    ? 16384
                    : 10000
              }
              value={editor!.text}
              onChange={(event) => setEditor({ ...editor!, text: event.target.value })}
            />
          </label>
          {error && (
            <p role="alert" className="danger-text">
              {error}
            </p>
          )}
          <div className="dialog-footer">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setEditor(null);
                setError(null);
              }}
            >
              <X size={16} />
              取消
            </Button>
            <Button
              type="submit"
              disabled={
                editor!.field === 'skills' && (!editor.text.trim() || !editor.title?.trim())
              }
            >
              <Save size={16} />
              保存
            </Button>
          </div>
        </form>
      </Modal>
    ) : null;
  return (
    <>
      <aside
        ref={panelRef}
        className="personal-panel personal-info-v2"
        data-open={open}
        inert={!open}
        aria-hidden={!open}
        aria-label="个人信息"
      >
        {resizeHandle}
        <header>
          <div>
            <h2>个人信息</h2>
            <small>{completed}/5 已完善</small>
          </div>
          <Button variant="ghost" size="icon" aria-label="关闭个人信息" onClick={onClose}>
            <X size={16} />
          </Button>
        </header>
        <div className="personal-panel-scroll">
          <p className="panel-description">
            资料保存在本机，必要内容用于聊天和本场面试。AI 更新会先展示提案，确认后保存。
          </p>
          <div className="profile-overview" aria-label="资料概览">
            {[
              { label: '简历', ready: !!state.info.background },
              { label: '职位描述', ready: !!state.info.jobDescription },
              { label: '自定义指令', ready: !!state.info.customInstructions?.length },
              { label: '面试知识库', ready: !!state.selectedKnowledgeBaseId && !selectedMissing },
              { label: '技能', ready: !!state.info.skills?.length },
            ].map((item) => (
              <span key={item.label} className={item.ready ? 'is-ready' : ''}>
                <Check size={13} />
                {item.label}
              </span>
            ))}
          </div>
          <section className="profile-section" aria-label="基本信息">
            <h3>姓名与面试语言</h3>
            <form
              id="personal-info-form"
              onSubmit={(event) => {
                event.preventDefault();
                if (conflict) {
                  setError('基本信息已有更新，请载入最新内容后继续编辑。');
                  return;
                }
                if (state.updateInfo(basic)) {
                  const next = basicInfo(usePreparation.getState().info);
                  base.current = next;
                  setBasic(next);
                  setError(null);
                } else setError(usePreparation.getState().error);
              }}
            >
              <label className="field-label">
                姓名
                <input
                  value={basic.name}
                  maxLength={60}
                  placeholder="你的名字"
                  onChange={(event) => setBasic({ ...basic, name: event.target.value })}
                />
              </label>
              <div className="field-label">
                面试语言
                <ChoiceMenu
                  label="面试语言"
                  value={basic.language}
                  options={languages.map((value) => ({ value, label: value }))}
                  onChange={(language) => setBasic({ ...basic, language })}
                />
              </div>
            </form>
          </section>
          {(['background', 'jobDescription', 'customInstructions'] as const).map((field) => (
            <details
              className="profile-section profile-disclosure"
              key={field}
              aria-label={profileLabels[field]}
            >
              <summary className="profile-section-heading">
                <h3>{profileLabels[field]}</h3>
                <span className="disclosure-chevron">
                  <ChevronRight size={16} />
                </span>
                {field !== 'customInstructions' && <span className="neutral-badge">AI 摘要</span>}
              </summary>
              <div className="profile-summary">
                {state.info[field] ? (
                  <ProfileValue value={state.info[field]} />
                ) : (
                  <p className="empty-inline">
                    {field === 'background'
                      ? '尚未添加简历摘要'
                      : field === 'jobDescription'
                        ? '尚未添加职位描述摘要'
                        : '尚未添加自定义指令'}
                  </p>
                )}
              </div>
              <div className="profile-section-actions">
                <Button
                  variant="ghost"
                  disabled={state.streaming || !!editor}
                  onClick={() => edit(field)}
                >
                  <Edit size={14} />
                  编辑
                </Button>
                <ConfirmDeleteButton
                  target={profileLabels[field]}
                  active={open && !editor}
                  revision={state.info[field]}
                  disabled={!state.info[field]}
                  onConfirm={() => state.updateInfo({ [field]: '' })}
                />
              </div>
              {field === 'background' && state.resume && (
                <small className="legacy-resume">已保留原件：{state.resume.name}</small>
              )}
            </details>
          ))}
          <details className="profile-section profile-disclosure" aria-label="面试知识库">
            <summary className="profile-section-heading">
              <h3>面试知识库</h3>
              <span className="disclosure-chevron">
                <ChevronRight size={16} />
              </span>
            </summary>
            <p className="section-help">仅由你选择，本场面试只检索这个知识库。AI 不能修改选择。</p>
            <ChoiceMenu
              label="面试知识库"
              disabled={!ragReady}
              value={state.selectedKnowledgeBaseId ?? ''}
              options={[
                { value: '', label: '不使用知识库' },
                ...(selectedMissing
                  ? [{ value: state.selectedKnowledgeBaseId!, label: '所选知识库已不可用' }]
                  : []),
                ...bases.map((item) => ({ value: item.id, label: item.name })),
              ]}
              onChange={(id) => {
                void state.selectKnowledgeBase(id || null).then((saved) => {
                  if (!saved) setError(usePreparation.getState().error);
                });
              }}
            />
            {!ragReady && <ComponentsNotice only="rag" onSettings={onComponentSettings} />}
            {(basesError || selectedMissing) && (
              <p role="alert" className="danger-text">
                {basesError || '所选知识库已删除，请重新选择或选择不使用。'}
              </p>
            )}
          </details>
          <details className="profile-section profile-disclosure" aria-label="面试技能">
            <summary className="profile-section-heading">
              <h3>技能</h3>
              <span className="disclosure-chevron">
                <ChevronRight size={16} />
              </span>
              <span>{state.info.skills?.length ?? 0}/10</span>
            </summary>
            {(state.info.skills ?? []).map((item) => (
              <details className="profile-entry" key={item.id}>
                <summary>
                  <PlainTextContent content={item.title} inline />
                  <span className="disclosure-chevron">
                    <ChevronRight size={14} />
                  </span>
                </summary>
                <div>
                  <ProfileValue value={[item]} hideTitle />
                  <div className="profile-section-actions">
                    <Button
                      variant="ghost"
                      disabled={!!editor}
                      onClick={() => edit('skills', item.id)}
                    >
                      <Edit size={14} />
                      编辑
                    </Button>
                    <ConfirmDeleteButton
                      target={'技能：' + item.title}
                      active={open && !editor}
                      revision={JSON.stringify(item)}
                      aria-label={'删除技能：' + item.title}
                      onConfirm={() =>
                        state.updateInfo({
                          skills: (usePreparation.getState().info.skills ?? []).filter(
                            (entry) => entry.id !== item.id,
                          ),
                        })
                      }
                    />
                  </div>
                </div>
              </details>
            ))}
            {!state.info.skills?.length && <p className="empty-inline">尚未添加技能</p>}
          </details>
        </div>
        {(dirty || conflict || (error && !editor)) && (
          <footer className="personal-save-bar">
            <span role="status">
              {conflict
                ? '基本信息已有更新'
                : dirty
                  ? '基本信息有未保存修改'
                  : 'AI 更新需在提案中确认'}
            </span>
            {error && (
              <p role="alert" className="danger-text">
                {error}
              </p>
            )}
            <div>
              {(dirty || conflict) && (
                <Button
                  variant="ghost"
                  onClick={() => {
                    const next = basicInfo(state.info);
                    base.current = next;
                    setBasic(next);
                    setError(null);
                  }}
                >
                  {conflict ? <Refresh size={16} /> : <X size={16} />}
                  {conflict ? '载入最新资料' : '取消'}
                </Button>
              )}
              <Button form="personal-info-form" type="submit" disabled={!dirty || conflict}>
                <Save size={16} />
                保存
              </Button>
            </div>
          </footer>
        )}
      </aside>
      {renderEditor()}
    </>
  );
}

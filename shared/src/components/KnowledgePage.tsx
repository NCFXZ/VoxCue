import { InterviewReveal } from './InterviewReveal';
import { t, uiLocale } from '../i18n';
import { SyncBadge } from './SyncBadge';
import { useKnowledgeIndex } from '../stores/knowledgeIndex';
import { useEffect, useRef, useState } from 'react';
import {
  Database,
  ArrowUp,
  FileText,
  ChevronRight,
  Plus,
  Edit,
  Loader,
  Folder,
  X,
  Save,
} from './icons';
import { Button } from './ui/button';
import { ConfirmDeleteButton } from './ui/confirm-delete-button';
import { AnimatedCollection } from './ui/AnimatedCollection';
import { Modal } from './ui/modal';
import { useKnowledge } from '../stores/knowledge';
import { documentAccept, documentRevision } from '../services/knowledge';
import { documentIndexLabel } from '../services/knowledgeIndex';
import { useComponentReady } from '../stores/components';
import { ComponentsNotice } from './ComponentsNotice';
import type { OpenComponentSettings } from '../services/componentSettingsTargets';
export function KnowledgePage({ onComponentSettings }: { onComponentSettings?: OpenComponentSettings }) {
  const ragReady = useComponentReady('rag');
  const state = useKnowledge();
  const index = useKnowledgeIndex();
  useEffect(() => index.connect(), []);
  const documents = new Map(index.state?.documents.map(doc => [doc.documentId, doc]));
  const removingBases = new Set(state.removals.filter(job => !job.documentId).map(job => job.baseId));
  const removingFiles = new Set(state.removals.map(job => job.documentId));
  const removingBase = state.selectedId !== null && removingBases.has(state.selectedId);
  const cardStatus = (baseId: string) => {
    if (removingBases.has(baseId)) return t('正在删除…');
    const percent = index.libraryProgress[baseId];
    return typeof percent === 'number' ? t('索引总进度 {0}%', [percent]) : t('本地资料');
  };
  const fileInput = useRef<HTMLInputElement>(null);
  const [name, setName] = useState('');
  const [editing, setEditing] = useState<'create' | 'rename' | null>(null);
  const [dragging, setDragging] = useState(false);
  const [gridReady, setGridReady] = useState(state.bases.length > 0);
  const base = state.bases.find((item) => item.id === state.selectedId);
  const baseRevision = documentRevision(base);
  const removalAlert = state.removalError && (
    <div role="alert" className="inline-error knowledge-inline-error">
      <span>{t(state.removalError)}</span>
      {state.removals.length > 0 ? (
        <Button variant="ghost" disabled={state.removalRunning} onClick={() => void state.resumeRemovals()}>
          {t('重试删除')}
        </Button>
      ) : (
        <Button variant="ghost" size="icon" aria-label={t('关闭错误提示')} onClick={state.dismissRemovalError}>
          <X size={16} />
        </Button>
      )}
    </div>
  );
  useEffect(() => {
    let current = true;
    void state.load().then(() => {
      if (current) setGridReady(true);
    });
    return () => { current = false; };
  }, []);
  return (
    <main className="workspace management-page knowledge-page">
      <header className="page-toolbar">
        <div className="breadcrumb">
          <strong>{t('知识库')}</strong>
        </div>
        <Button
          aria-label={t('创建知识库')}
          size="icon"
          disabled={!ragReady}
          onClick={() => {
            state.dismissEditorError();
            setName('');
            setEditing('create');
          }}
        >
          <Plus size={16} />
        </Button>
      </header>
      <div className="management-scroll">
        <div className="management-container">
          <ComponentsNotice only="rag" onSettings={onComponentSettings} />
          <InterviewReveal>{!base ? removalAlert : null}</InterviewReveal>
          <InterviewReveal resizeKey={state.error ?? ''}>
            {state.error && state.errorBaseId === null && !base && !editing ? (
              <p role="alert" className="inline-error">
                {t(state.error)}
              </p>
            ) : null}
          </InterviewReveal>
          <AnimatedCollection className="knowledge-grid" enabled={gridReady} wrapped waitForDialogExit>
            {!state.bases.length ? [
              <div className="management-empty" key="empty">
                <Database size={36} />
                <h2>{t('创建你的第一个知识库')}</h2>
                <Button
                  variant="outline"
                  disabled={!ragReady}
                  onClick={() => {
                    state.dismissEditorError();
                    setName('');
                    setEditing('create');
                  }}
                >
                  <Plus size={16} />
                  {t('创建知识库')}
                </Button>
              </div>,
            ] : state.bases.map((item) => (
              <div
                className="knowledge-card-wrap"
                key={item.id}
                data-motion-revision={JSON.stringify([item.name, typeof index.libraryProgress[item.id] === 'number'])}
              >
                <button
                  className="knowledge-card"
                  disabled={removingBases.has(item.id)}
                  onClick={() => {
                    void state.open(item.id);
                  }}
                >
                  <span className="knowledge-icon">
                    <Database size={22} />
                  </span>
                  <h2>{item.name}</h2>
                  <p>
                    {t('创建于 ')}
                    {new Date(item.createdAt).toLocaleDateString(uiLocale())}
                  </p>
                  <span className="card-footer">
                    {cardStatus(item.id)}
                    <ChevronRight size={14} />
                  </span>
                </button>
                <SyncBadge itemKey={'base:' + item.id} label={item.name} />
              </div>
            ))}
          </AnimatedCollection>
        </div>
      </div>
      {base && (
        <Modal
          wide
          className="knowledge-detail-dialog"
          fixedHeader
          overlayHeader
          title={base.name}
          onClose={() => {
            if (!state.busy) {
              void state.open(null);
            }
          }}
          titleAction={
            <>
              <Button
                disabled={state.busy || removingBase}
                variant="ghost"
                size="icon"
                className="action-icon-button"
                data-reveal-on-hover
                aria-label={t('重命名')}
                onClick={() => {
                  state.dismissEditorError();
                  setName(base.name);
                  setEditing('rename');
                }}
              >
                <Edit size={17} />
              </Button>
            </>
          }
          action={
            <>
              <SyncBadge itemKey={'base:' + base.id} label={base.name} />
              <ConfirmDeleteButton
                key={base.id}
                label={t('删除知识库')}
                aria-label={t('删除知识库')}
                target={t('知识库：') + base.name}
                warning={t('将删除这个知识库及全部本地文档，无法恢复')}
                revision={baseRevision}
                active={!editing}
                disabled={state.busy || removingBase}
                onConfirm={() =>
                  useKnowledge.getState().selectedId === base.id ? state.removeBase(baseRevision) : false
                }
              />
            </>
          }
        >
          <InterviewReveal>{removalAlert}</InterviewReveal>
          <InterviewReveal resizeKey={state.error ?? ''}>
            {state.error && state.errorBaseId === base.id ? (
              <div role="alert" className="inline-error knowledge-inline-error">
                <span>{t(state.error)}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="history-search-clear"
                  aria-label={t('关闭错误提示')}
                  data-reveal-on-hover
                  onClick={state.dismissError}
                >
                  <X size={14} />
                </Button>
              </div>
            ) : null}
          </InterviewReveal>
          <InterviewReveal resizeKey={index.error ?? ''}>
            {index.error ? (
              <div role="alert" className="inline-error knowledge-inline-error">
                <span>{t(index.error)}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="history-search-clear"
                  aria-label={t('关闭错误提示')}
                  data-reveal-on-hover
                  onClick={index.dismissError}
                >
                  <X size={14} />
                </Button>
              </div>
            ) : null}
          </InterviewReveal>
          <ComponentsNotice only="rag" onSettings={onComponentSettings} />
          <h3 className="dialog-section-title">
            {t('文档列表 ')}
            <span>{state.documents.length}</span>
          </h3>
          <div
            className={`upload-dropzone ${dragging ? 'dragging' : ''}`}
            aria-busy={state.busy}
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              if (!state.busy) void state.importFiles(Array.from(event.dataTransfer.files));
            }}
          >
            <span className="knowledge-icon">
              <ArrowUp size={22} />
            </span>
            <h3>{state.busy ? t('正在保存到本地…') : t('将文件拖放到此处')}</h3>
            <p>
              {t('支持 PDF、Word、TXT 和 Markdown 文件')}
              <br />
              {t('单文件最大 20 MB，每次最多 20 个；同名文件将替换旧文件')}
            </p>
            <Button
              disabled={state.busy}
              variant="outline"
              onClick={() => fileInput.current?.click()}
            >
              <Folder size={16} />
              {t('选择文件')}
            </Button>
            <input
              ref={fileInput}
              type="file"
              multiple
              disabled={state.busy}
              accept={documentAccept}
              aria-label={t('导入知识库文档')}
              className="sr-only"
              onChange={(event) => {
                void state.importFiles(Array.from(event.target.files ?? []));
                event.target.value = '';
              }}
            />
          </div>
          <AnimatedCollection key={base.id} className="document-list" resizeDialog>
            {state.loading ? [
              <p className="empty-inline" key="loading">{t('正在读取文档…')}</p>,
            ] : !state.documents.length ? [
              <p className="empty-inline document-empty" key="empty">{t('当前知识库还没有文档')}</p>,
            ] : state.documents.map((doc) => {
                const revision = documentRevision(doc);
                const task = index.tasks[doc.id];
                const deleting = index.deletingDocumentIds?.has(doc.id);
                const removing = removingBase || removingFiles.has(doc.id);
                const label = removing ? '正在删除…' : documentIndexLabel(documents.get(doc.id), task, {
                  requestId: index.requests[doc.id], deleting, hasSnapshot: !!index.state,
                });
                const error = !removing && !deleting && task?.phase === 'failed' ? task.error : undefined;
                return (
                  <div className="document-row" key={doc.id}
                    data-motion-revision={JSON.stringify([revision, label?.replace(/\d+%/, ''), error])}>
                    <FileText size={18} />
                    <div className="document-details">
                      <strong>{doc.name}</strong>
                      <div className="document-status">
                        <span className="document-status-prefix" role={removing ? 'status' : undefined}>
                          {doc.size < 1024 ? `${doc.size} B` : `${Math.ceil(doc.size / 1024)} KB`}
                          {label && ' · ' + t(label)}
                          {error ? ': ' : ''}
                        </span>
                        <InterviewReveal resizeKey={error ?? ''}>
                          {error ? <span className="document-status-message" role="alert">{t(error)}</span> : null}
                        </InterviewReveal>
                      </div>
                    </div>
                    <div className="document-actions">
                      <SyncBadge itemKey={'file:' + doc.id} label={doc.name} />
                      <ConfirmDeleteButton
                        iconOnly
                        disabled={state.busy || removing}
                        active={!editing}
                        target={t('文档：') + doc.name}
                        revision={revision}
                        warning={t('将删除原件及当前索引，无法恢复')}
                        aria-label={t('删除文档 ') + doc.name}
                        onConfirm={() => useKnowledge.getState().selectedId === base.id ? state.removeDocument(doc.id, revision) : false}
                      />
                    </div>
                  </div>
                );
            })}
          </AnimatedCollection>
        </Modal>
      )}
      {editing && (
        <Modal
          title={editing === 'create' ? t('创建知识库') : t('重命名知识库')}
          className="knowledge-editor-dialog"
          onClose={() => {
            if (!state.busy) {
              state.dismissEditorError();
              setEditing(null);
            }
          }}
        >
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              const ok = editing === 'create' ? await state.create(name) : await state.rename(name);
              if (ok) setEditing(null);
            }}
          >
            <label className="field-label">
              {t('知识库名称')}
              <input
                autoFocus
                maxLength={60}
                required
                value={name}
                placeholder={t('例如：前端工程师 · 项目资料')}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <InterviewReveal resizeKey={state.editorError ?? ''}>
              {state.editorError ? (
                <p role="alert" className="inline-error">
                  {t(state.editorError)}
                </p>
              ) : null}
            </InterviewReveal>
            <div className="dialog-footer">
              <Button
                type="button"
                variant="ghost"
                disabled={state.busy}
                onClick={() => {
                  state.dismissEditorError();
                  setEditing(null);
                }}
              >
                <X size={16} />
                {t('取消')}
              </Button>
              <Button type="submit" disabled={state.busy || !name.trim()}>
                {state.busy ? <Loader size={16} /> : <Save size={16} />}
                {state.busy ? t('保存中') : t('保存')}
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </main>
  );
}

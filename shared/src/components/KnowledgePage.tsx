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
import { Modal } from './ui/modal';
import { useKnowledge } from '../stores/knowledge';
import { documentAccept } from '../services/knowledge';
import { knowledgeStatusLabel } from '../services/knowledgeIndex';
import { useComponentReady } from '../stores/components';
import { ComponentsNotice } from './ComponentsNotice';
export function KnowledgePage({ onComponentSettings }: { onComponentSettings?(): void }) {
  const ragReady = useComponentReady('rag');
  const state = useKnowledge();
  const index = useKnowledgeIndex();
  useEffect(() => index.connect(), []);
  const phase = (id: string) => {
    const status = index.tasks[id];
    if (status) return knowledgeStatusLabel(status);
    const doc = index.state?.documents.find((doc) => doc.documentId === id);
    return doc ? (doc.available === false ? '索引已停用' : '索引完成') : '尚未索引';
  };
  const fileInput = useRef<HTMLInputElement>(null);
  const [name, setName] = useState('');
  const [editing, setEditing] = useState<'create' | 'rename' | null>(null);
  const [dragging, setDragging] = useState(false);
  const base = state.bases.find((item) => item.id === state.selectedId);
  useEffect(() => {
    void state.load();
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
            setName('');
            setEditing('create');
          }}
        >
          <Plus size={16} />
        </Button>
      </header>
      <div className="management-scroll">
        <div className="management-container">
          {!ragReady && <ComponentsNotice only="rag" onSettings={onComponentSettings} />}
          {state.error && !base && !editing && (
            <p role="alert" className="inline-error">
              {t(state.error)}
            </p>
          )}
          {!state.bases.length ? (
            <div className="management-empty">
              <Database size={36} />
              <h2>{t('创建你的第一个知识库')}</h2>
              <Button
                variant="outline"
                disabled={!ragReady}
                onClick={() => {
                  setName('');
                  setEditing('create');
                }}
              >
                <Plus size={16} />
                {t('创建知识库')}
              </Button>
            </div>
          ) : (
            <div className="knowledge-grid">
              {state.bases.map((item) => (
                <div className="knowledge-card-wrap" key={item.id}>
                  <button
                    className="knowledge-card"
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
                      {t('本地资料')}
                      <ChevronRight size={14} />
                    </span>
                  </button>
                  <SyncBadge itemKey={'base:' + item.id} label={item.name} />
                </div>
              ))}
            </div>
          )}
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
                disabled={state.busy}
                variant="ghost"
                size="icon"
                className="action-icon-button"
                data-reveal-on-hover
                aria-label={t('重命名')}
                onClick={() => {
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
                revision={base.name}
                active={!editing}
                disabled={state.busy}
                onConfirm={() =>
                  useKnowledge.getState().selectedId === base.id ? state.removeBase() : false
                }
              />
            </>
          }
        >
          {state.error && (
            <p role="alert" className="inline-error">
              {t(state.error)}
            </p>
          )}
          {index.error && (
            <p role="alert" className="inline-error">
              {t(index.error)}
            </p>
          )}
          {!ragReady && <ComponentsNotice only="rag" onSettings={onComponentSettings} />}
          <h3 className="dialog-section-title">
            {t('文档列表 ')}
            <span>{state.documents.length}</span>
          </h3>
          <div
            className={`upload-dropzone ${dragging ? 'dragging' : ''}`}
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
              {t('PDF、Word、PowerPoint、Excel、TXT、Markdown')}
              <br />
              {t('单文件最大 20 MB，每次最多 20 个；同名替换前备份旧原件。')}
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
              accept={documentAccept}
              aria-label={t('导入知识库文档')}
              className="sr-only"
              onChange={(event) => {
                void state.importFiles(Array.from(event.target.files ?? []));
                event.target.value = '';
              }}
            />
          </div>
          <div className="document-list">
            {state.loading ? (
              <p className="empty-inline">{t('正在读取文档…')}</p>
            ) : !state.documents.length ? (
              <p className="empty-inline document-empty">{t('当前知识库还没有文档')}</p>
            ) : (
              state.documents.map((doc) => (
                <div className="document-row" key={doc.id}>
                  <FileText size={18} />
                  <div className="document-details">
                    <strong>{doc.name}</strong>
                    <p>
                      {doc.size < 1024 ? `${doc.size} B` : `${Math.ceil(doc.size / 1024)} KB`}
                      {' · '}
                      {t(phase(doc.id))}
                    </p>
                    {index.tasks[doc.id]?.error && (
                      <p role="alert" className="document-error">
                        {t(index.tasks[doc.id].error)}
                      </p>
                    )}
                  </div>
                  <div className="document-actions">
                    <SyncBadge itemKey={'file:' + doc.id} label={doc.name} />
                    <ConfirmDeleteButton
                      iconOnly
                      disabled={state.busy}
                      active={!editing}
                      target={t('文档：') + doc.name}
                      revision={doc.createdAt}
                      warning={t('将删除原件及当前索引，无法恢复')}
                      aria-label={t('删除文档 ') + doc.name}
                      onConfirm={async () => {
                        const ok = await state.removeDocument(doc.id);
                        if (ok) await index.refresh();
                        return ok;
                      }}
                    />
                  </div>
                </div>
              ))
            )}
          </div>
        </Modal>
      )}
      {editing && (
        <Modal
          title={editing === 'create' ? t('创建知识库') : t('重命名知识库')}
          className="knowledge-editor-dialog"
          onClose={() => {
            if (!state.busy) setEditing(null);
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
            {state.error && (
              <p role="alert" className="inline-error">
                {t(state.error)}
              </p>
            )}
            <div className="dialog-footer">
              <Button
                type="button"
                variant="ghost"
                disabled={state.busy}
                onClick={() => setEditing(null)}
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

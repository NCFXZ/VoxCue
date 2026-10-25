import { useKnowledgeIndex } from '../stores/knowledgeIndex';
import { useEffect, useRef, useState } from 'react';
import {
  Database,
  ArrowUp,
  MessageSquare,
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
import { useComponentReady } from '../stores/components';
import { ComponentsNotice } from './ComponentsNotice';
export function KnowledgePage({ onComponentSettings }: { onComponentSettings?(): void }) {
  const ragReady = useComponentReady('rag');
  const state = useKnowledge();
  const index = useKnowledgeIndex();
  useEffect(() => index.connect(), []);
  const phase = (id: string) => {
    const status = index.tasks[id];
    if (status) {
      if (status.phase === 'ready') return '索引完成';
      if (status.phase === 'failed') return '索引失败';
      if (status.phase === 'cancelled') return '已取消';
      const percent = status.total
        ? Math.min(99, Math.max(0, Math.floor((status.completed / status.total) * 100)))
        : 0;
      return `索引中 ${percent}%`;
    }
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
          <strong>知识库</strong>
        </div>
        <Button
          aria-label="创建知识库"
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
              {state.error}
            </p>
          )}
          {!state.bases.length ? (
            <div className="management-empty">
              <Database size={36} />
              <h2>创建你的第一个知识库</h2>
              <Button
                variant="outline"
                disabled={!ragReady}
                onClick={() => {
                  setName('');
                  setEditing('create');
                }}
              >
                <Plus size={16} />
                创建知识库
              </Button>
            </div>
          ) : (
            <div className="knowledge-grid">
              {state.bases.map((item) => (
                <button
                  key={item.id}
                  className="knowledge-card"
                  onClick={() => {
                    void state.open(item.id);
                  }}
                >
                  <span className="knowledge-icon">
                    <Database size={22} />
                  </span>
                  <h2>{item.name}</h2>
                  <p>创建于 {new Date(item.createdAt).toLocaleDateString('zh-CN')}</p>
                  <span className="card-footer">
                    本地资料
                    <ChevronRight size={14} />
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      {base && (
        <Modal
          wide
          className="knowledge-detail-dialog"
          title={base.name}
          onClose={() => {
            if (!state.busy) {
              void state.open(null);
            }
          }}
          titleAction={
            <Button
              disabled={state.busy}
              variant="ghost"
              size="icon"
              className="action-icon-button"
              data-reveal-on-hover
              aria-label="重命名"
              onClick={() => {
                setName(base.name);
                setEditing('rename');
              }}
            >
              <Edit size={17} />
            </Button>
          }
          action={
            <>
              <ConfirmDeleteButton
                key={base.id}
                label="删除知识库"
                aria-label="删除知识库"
                target={'知识库：' + base.name}
                warning="将删除这个知识库及全部本地文档，无法恢复"
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
              {state.error}
            </p>
          )}
          {index.error && (
            <p role="alert" className="inline-error">
              {index.error}
            </p>
          )}
          {!ragReady && <ComponentsNotice only="rag" onSettings={onComponentSettings} />}
          <h3 className="dialog-section-title">
            文档列表 <span>{state.documents.length}</span>
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
            <h3>{state.busy ? '正在保存到本地…' : '将文件拖放到此处'}</h3>
            <p>
              PDF、Word、PowerPoint、Excel、TXT、Markdown
              <br />
              单文件最大 20 MB，每次最多 20 个；同名替换前备份旧原件。
            </p>
            <Button
              disabled={state.busy}
              variant="outline"
              onClick={() => fileInput.current?.click()}
            >
              <Folder size={16} />
              选择文件
            </Button>
            <input
              ref={fileInput}
              type="file"
              multiple
              accept={documentAccept}
              aria-label="导入知识库文档"
              className="sr-only"
              onChange={(event) => {
                void state.importFiles(Array.from(event.target.files ?? []));
                event.target.value = '';
              }}
            />
          </div>
          <div className="document-list">
            {state.loading ? (
              <p className="empty-inline">正在读取文档…</p>
            ) : !state.documents.length ? (
              <p className="empty-inline document-empty">当前知识库还没有文档</p>
            ) : (
              state.documents.map((doc) => (
                <div className="document-row" key={doc.id}>
                  <MessageSquare size={18} />
                  <div className="document-details">
                    <strong>{doc.name}</strong>
                    <p>
                      {doc.size < 1024 ? `${doc.size} B` : `${Math.ceil(doc.size / 1024)} KB`}
                      {' · '}
                      {phase(doc.id)}
                    </p>
                    {index.tasks[doc.id]?.error && (
                      <p role="alert" className="document-error">
                        {index.tasks[doc.id].error}
                      </p>
                    )}
                  </div>
                  <div className="document-actions">
                    <ConfirmDeleteButton
                      iconOnly
                      disabled={state.busy}
                      active={!editing}
                      target={'文档：' + doc.name}
                      revision={doc.createdAt}
                      warning="将删除原件及当前索引，无法恢复"
                      aria-label={'删除文档 ' + doc.name}
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
          title={editing === 'create' ? '创建知识库' : '重命名知识库'}
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
              知识库名称
              <input
                autoFocus
                maxLength={60}
                required
                value={name}
                placeholder="例如：前端工程师 · 项目资料"
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            {state.error && (
              <p role="alert" className="inline-error">
                {state.error}
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
                取消
              </Button>
              <Button type="submit" disabled={state.busy || !name.trim()}>
                {state.busy ? <Loader size={16} /> : <Save size={16} />}
                {state.busy ? '保存中' : '保存'}
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </main>
  );
}

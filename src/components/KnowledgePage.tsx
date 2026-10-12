import { useEffect, useRef, useState } from 'react';
import { Database, ArrowUp, Trash, MessageSquare } from './icons';
import { Button } from './ui/button';
import { Modal } from './ui/modal';
import { useKnowledge } from '../stores/knowledge';
import { documentAccept, previewDocument } from '../services/knowledge';
export function KnowledgePage() {
  const state = useKnowledge();
  const fileInput = useRef<HTMLInputElement>(null);
  const [name, setName] = useState('');
  const [editing, setEditing] = useState<'create' | 'rename' | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [preview, setPreview] = useState<{ name: string; text: string } | null>(null);
  const [dragging, setDragging] = useState(false);
  const base = state.bases.find((item) => item.id === state.selectedId);
  useEffect(() => {
    void state.load();
  }, []);
  return (
    <main className="workspace management-page">
      <header className="page-toolbar">
        <div className="breadcrumb">
          工作空间<span>/</span>
          <strong>知识库</strong>
        </div>
        <Button
          onClick={() => {
            setName('');
            setEditing('create');
          }}
        >
          ＋ 创建知识库
        </Button>
      </header>
      <div className="management-scroll">
        <div className="management-container">
          <p className="local-storage-note">文件仅存储在本机 · 文档解析和 AI 检索尚未接入</p>
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
                onClick={() => {
                  setName('');
                  setEditing('create');
                }}
              >
                ＋ 创建知识库
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
                    本地资料<span>↗</span>
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
          title={base.name}
          onClose={() => {
            if (!state.busy) {
              void state.open(null);
              setDeleting(false);
            }
          }}
          action={
            <>
              <Button
                disabled={state.busy}
                variant="ghost"
                onClick={() => {
                  setName(base.name);
                  setEditing('rename');
                }}
              >
                重命名
              </Button>
              <Button disabled={state.busy} variant="dangerGhost" onClick={() => setDeleting(true)}>
                <Trash size={15} />
                删除知识库
              </Button>
            </>
          }
        >
          <p className="dialog-intro">
            管理这份知识库中的文档。原始文件保存在本机，尚未建立检索索引。
          </p>
          {state.error && (
            <p role="alert" className="inline-error">
              {state.error}
            </p>
          )}
          {deleting && (
            <div className="delete-confirm" role="alert">
              <span>删除知识库及全部本地文档？此操作无法恢复。</span>
              <Button disabled={state.busy} variant="ghost" onClick={() => setDeleting(false)}>
                取消
              </Button>
              <Button
                variant="destructive"
                disabled={state.busy}
                onClick={async () => {
                  if (await state.removeBase()) setDeleting(false);
                }}
              >
                确认删除
              </Button>
            </div>
          )}
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
              单文件最大 20 MB，每次最多 20 个；同名文件将被替换。
            </p>
            <Button
              disabled={state.busy}
              variant="outline"
              onClick={() => fileInput.current?.click()}
            >
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
                  <div>
                    <strong>{doc.name}</strong>
                    <p>
                      {doc.size < 1024 ? `${doc.size} B` : `${Math.ceil(doc.size / 1024)} KB`} ·
                      已保存本地 ·{' '}
                      {/\.(txt|md)$/i.test(doc.name) ? '可预览文本，未索引' : '待接入解析'}
                    </p>
                  </div>
                  <Button
                    disabled={state.busy}
                    variant="ghost"
                    onClick={async () => {
                      try {
                        setPreview({ name: doc.name, text: await previewDocument(doc) });
                      } catch {
                        setPreview({ name: doc.name, text: '读取文件失败，请重新导入。' });
                      }
                    }}
                  >
                    预览
                  </Button>
                  <Button
                    disabled={state.busy}
                    variant="dangerGhost"
                    size="icon"
                    aria-label={`删除文档 ${doc.name}`}
                    onClick={() => {
                      void state.removeDocument(doc.id);
                    }}
                  >
                    <Trash size={15} />
                  </Button>
                </div>
              ))
            )}
          </div>
        </Modal>
      )}
      {editing && (
        <Modal
          title={editing === 'create' ? '创建知识库' : '重命名知识库'}
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
                取消
              </Button>
              <Button type="submit" disabled={state.busy || !name.trim()}>
                {state.busy ? '正在保存…' : '保存'}
              </Button>
            </div>
          </form>
        </Modal>
      )}
      {preview && (
        <Modal wide title={preview.name} onClose={() => setPreview(null)}>
          <pre className="document-preview">{preview.text}</pre>
        </Modal>
      )}
    </main>
  );
}

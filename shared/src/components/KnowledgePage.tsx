import { useKnowledgeIndex } from '../stores/knowledgeIndex';
import { useEffect, useRef, useState } from 'react';
import { Database, ArrowUp, MessageSquare, ChevronRight } from './icons';
import { Button } from './ui/button';
import { ConfirmDeleteButton } from './ui/confirm-delete-button';
import { ChoiceMenu } from './ui/choice-menu';
import { Modal } from './ui/modal';
import { useKnowledge } from '../stores/knowledge';
import { documentAccept, previewDocument } from '../services/knowledge';
import { useModelProvider } from './useModelProvider';
export function KnowledgePage() {
  const state = useKnowledge();
  const provider = useModelProvider();
  const index = useKnowledgeIndex();
  const [query, setQuery] = useState('');
  const [searched, setSearched] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  useEffect(() => {
    setSearched(false);
    setQuery('');
  }, [state.selectedId]);
  const [searchMode, setSearchMode] = useState<'keyword' | 'vector' | 'hybrid'>('hybrid');
  useEffect(() => index.connect(), []);
  const phase = (id: string) => {
    const status = index.tasks[id];
    if (status)
      return (
        {
          queued: '排队中',
          parsing: '解析中',
          embedding: '准备内容',
          indexing: '保存处理结果',
          ready: '可用于回答',
          failed: '处理失败',
          cancelled: '已取消',
        }[status.phase] + (status.total ? ` ${status.completed}/${status.total}` : '')
      );
    const doc = index.state?.documents.find((doc) => doc.documentId === id);
    return doc ? (doc.available === false ? '旧内容已停用，请重试准备' : '可用于回答') : '尚未准备';
  };
  const fileInput = useRef<HTMLInputElement>(null);
  const [name, setName] = useState('');
  const [editing, setEditing] = useState<'create' | 'rename' | null>(null);
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
          <p className="local-storage-note">
            文档原件保存在本机 ·{' '}
            {index.state?.documents.filter((doc) => doc.available !== false).length ?? 0} 个可用文档
            · 回答时会发送必要的相关片段至 {provider.dataRecipient}
          </p>
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
          title={base.name}
          onClose={() => {
            if (!state.busy) {
              void state.open(null);
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
              <ConfirmDeleteButton
                key={base.id}
                label="删除知识库"
                aria-label="删除知识库"
                target={'知识库：' + base.name}
                warning="将删除这个知识库及全部本地文档，无法恢复"
                revision={base.name}
                active={!editing && !preview}
                disabled={state.busy}
                onConfirm={() =>
                  useKnowledge.getState().selectedId === base.id ? state.removeBase() : false
                }
              />
            </>
          }
        >
          <p className="dialog-intro">
            原件跨聊天保存在本机。PDF、DOCX、TXT 和 Markdown 可用于回答；其他 Office
            文件仅保留原件。相关片段会随回答请求发送至 {provider.dataRecipient}。
          </p>
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
          {index.state && !index.state.modelReady && (
            <p role="alert" className="inline-error">
              资料处理组件缺失。请使用包含本地模型的完整安装包修复安装，再重试准备；原件已保留。
            </p>
          )}
          <form
            className="knowledge-search"
            onSubmit={async (event) => {
              event.preventDefault();
              setSearched(false);
              await index.search(query, base.id, searchMode);
              if (useKnowledge.getState().selectedId === base.id) setSearched(true);
            }}
          >
            <input
              aria-label="知识库检索问题"
              placeholder="在此知识库中查找资料"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              maxLength={6000}
            />
            <Button
              type="button"
              variant="ghost"
              aria-expanded={advanced}
              onClick={() => {
                setAdvanced(!advanced);
                if (advanced) setSearchMode('hybrid');
              }}
            >
              高级选项
            </Button>
            {advanced && (
              <ChoiceMenu<typeof searchMode>
                label="检索方式"
                value={searchMode}
                options={
                  [
                    { value: 'hybrid', label: '混合' },
                    { value: 'keyword', label: '关键词' },
                    { value: 'vector', label: '向量' },
                  ] as const
                }
                onChange={setSearchMode}
              />
            )}
            <Button type="submit" disabled={!query.trim() || index.searching}>
              {index.searching ? '查找中…' : '查找资料'}
            </Button>
          </form>
          {searched && !index.searching && !index.error && !index.hits.length && (
            <p className="empty-inline">未找到相关资料。请换个关键词，或检查文档是否已准备完成。</p>
          )}
          {!!index.hits.length && (
            <div className="knowledge-hits">
              {index.hits
                .filter((hit) => hit.baseId === base.id)
                .map((hit) => (
                  <button
                    key={hit.itemId}
                    onClick={async () => {
                      try {
                        const item = await index.item(hit.itemId);
                        setPreview({
                          name: hit.title,
                          text: item?.content ?? '资料已删除或更新，请重新检索。',
                        });
                      } catch (e) {
                        setPreview({
                          name: hit.title,
                          text: e instanceof Error ? e.message : '读取失败',
                        });
                      }
                    }}
                  >
                    <strong>{hit.title}</strong>
                    <small>
                      {hit.name}
                      {hit.page ? ' · 第 ' + hit.page + ' 页' : ''}
                      {advanced ? ' · 相似分数 ' + hit.score.toFixed(3) : ''}
                    </small>
                    <p>{hit.excerpt.slice(0, 180)}</p>
                  </button>
                ))}
            </div>
          )}
          <h3 className="dialog-section-title">
            文档列表 <span>{state.documents.length}</span>
          </h3>
          <div
            className={`upload-dropzone ${state.documents.length ? 'is-compact' : ''} ${dragging ? 'dragging' : ''}`}
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
            <h3>
              {state.busy
                ? '正在保存到本地…'
                : state.documents.length
                  ? '添加文档或拖放文件'
                  : '将文件拖放到此处'}
            </h3>
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
                      {doc.size < 1024 ? `${doc.size} B` : `${Math.ceil(doc.size / 1024)} KB`} ·
                      更新时间 {new Date(doc.createdAt).toLocaleString('zh-CN')} · 原件已保存 ·{' '}
                      {phase(doc.id)}
                      {index.tasks[doc.id]?.error && (
                        <span className="document-error"> · {index.tasks[doc.id].error}</span>
                      )}
                    </p>
                  </div>
                  <div className="document-actions">
                    {index.requests[doc.id] ? (
                      <Button variant="ghost" onClick={() => void index.cancel(doc.id)}>
                        取消准备
                      </Button>
                    ) : (
                      <Button variant="ghost" onClick={() => void index.index(doc, true)}>
                        {index.state?.documents.some((item) => item.documentId === doc.id)
                          ? '重新准备'
                          : '准备用于回答'}
                      </Button>
                    )}
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
                    <ConfirmDeleteButton
                      iconOnly
                      disabled={state.busy}
                      active={!editing && !preview}
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

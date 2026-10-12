import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { useState } from 'react';
import { usePreparation } from '../stores/preparation';
import { Modal } from './ui/modal';
import {
  AudioLines,
  MessageCirclePlus,
  History,
  Database,
  ChevronsUpDown,
  Settings,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  ArrowUpRight,
  Trash,
} from './icons';
import { Button } from './ui/button';
import { UsagePanel } from './UsagePanel';
import { useChatConnection } from '../stores/chatConnection';
interface Props {
  userName: string;
  accountLabel: string;
  page: 'preparation' | 'history' | 'knowledge';
  onNavigate(page: 'preparation' | 'history' | 'knowledge'): void;
  collapsed: boolean;
  onCollapse(): void;
  onNew(): void;
  onSettings(): void;
  onLogout(): void;
}
export function Sidebar({
  userName,
  accountLabel,
  page,
  onNavigate,
  collapsed,
  onCollapse,
  onNew,
  onSettings,
  onLogout,
}: Props) {
  const connection = useChatConnection();
  const preparation = usePreparation();
  const [deleting, setDeleting] = useState<string | null>(null);
  const selected = preparation.conversations.find((item) => item.id === deleting);
  return (
    <aside className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
      <div className="sidebar-heading">
        <span className="sidebar-wordmark">
          <AudioLines size={22} />{' '}
          <strong>
            Copilot<span>面试练习助手</span>
          </strong>
        </span>
        <Button
          variant="ghost"
          size="icon"
          onClick={onCollapse}
          aria-label={collapsed ? '展开侧栏' : '收起侧栏'}
        >
          {collapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
        </Button>
      </div>
      <nav aria-label="主导航">
        <button
          className={`nav-item ${page === 'preparation' ? 'active' : ''}`}
          aria-label="新对话"
          onClick={onNew}
          title="新对话"
        >
          <MessageCirclePlus size={18} />
          <span>新对话</span>
          <kbd>＋</kbd>
        </button>
        <button
          className={`nav-item ${page === 'history' ? 'active' : ''}`}
          aria-label="面试记录"
          onClick={() => onNavigate('history')}
          title="面试记录"
        >
          <History size={18} />
          <span>面试记录</span>
        </button>
        <button
          className={`nav-item ${page === 'knowledge' ? 'active' : ''}`}
          aria-label="知识库"
          onClick={() => onNavigate('knowledge')}
          title="知识库"
        >
          <Database size={18} />
          <span>知识库</span>
        </button>
      </nav>
      {!collapsed && (
        <div className="sidebar-conversations">
          {preparation.conversations.length > 0 && <p className="section-caption">对话</p>}
          {preparation.conversations
            .slice()
            .reverse()
            .map((conversation) => (
              <div
                key={conversation.id}
                className={`conversation-row ${preparation.activeConversation === conversation.id && page === 'preparation' ? 'active' : ''}`}
              >
                <button
                  className="conversation"
                  title={conversation.title}
                  onClick={() => {
                    preparation.selectConversation(conversation.id);
                    onNavigate('preparation');
                  }}
                >
                  <span className="conversation-dot" />
                  <span>{conversation.title}</span>
                </button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="conversation-delete"
                  aria-label={`删除对话：${conversation.title}`}
                  onClick={() => setDeleting(conversation.id)}
                >
                  <Trash size={15} />
                </Button>
              </div>
            ))}
        </div>
      )}
      <div className="sidebar-bottom">
        {!collapsed && <UsagePanel />}
        {!collapsed && (
          <div className="local-note">
            <span className="status-dot" />
            {connection.live ? 'ChatGPT 已连接' : '本地模拟环境'}
            <ArrowUpRight size={13} />
            {!connection.live && <p>从容练习，清晰表达。</p>}
          </div>
        )}
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button className="user-button" aria-label="用户菜单">
              <span className="avatar">{userName.slice(0, 1).toUpperCase()}</span>
              <span className="user-info">
                <strong title={userName}>{userName}</strong>
                <small title={accountLabel}>{accountLabel}</small>
              </span>
              <ChevronsUpDown size={15} />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              className="dropdown-content"
              side="top"
              align="start"
              sideOffset={8}
            >
              <DropdownMenu.Item className="dropdown-item" onSelect={onSettings}>
                <Settings size={16} />
                设置
              </DropdownMenu.Item>
              <DropdownMenu.Separator className="dropdown-separator" />
              <DropdownMenu.Item className="dropdown-item" onSelect={onLogout}>
                <LogOut size={16} />
                退出登录
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>
      {selected && (
        <Modal title="删除对话" onClose={() => setDeleting(null)}>
          <p className="delete-conversation-description">
            确定删除“{selected.title}”吗？删除后无法恢复。
          </p>
          <div className="delete-conversation-actions">
            <Button variant="outline" onClick={() => setDeleting(null)}>
              取消
            </Button>
            <Button
              onClick={() => {
                const active = preparation.activeConversation === selected.id;
                preparation.deleteConversation(selected.id);
                setDeleting(null);
                if (active) onNavigate('preparation');
              }}
            >
              确认删除
            </Button>
          </div>
        </Modal>
      )}
    </aside>
  );
}

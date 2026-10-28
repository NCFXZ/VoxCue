import * as DropdownMenu from './ui/dropdown-menu';
import { useEffect, useState } from 'react';
import { usePreparation } from '../stores/preparation';
import { Modal } from './ui/modal';
import {
  MessageCirclePlus,
  History,
  Database,
  ChevronsUpDown,
  Settings,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  Loader,
  Refresh,
  X,
} from './icons';
import { Button } from './ui/button';
import { ConfirmDeleteButton } from './ui/confirm-delete-button';
import { AppLogo } from './AppLogo';
import { useChatConnection } from '../stores/chatConnection';
import { accountUsageSummary } from '../services/accountUsageSummary';
import { SidebarUpdate } from './SidebarUpdate';
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
  useEffect(() => {
    if (!connection.live) return;
    const refresh = () => {
      void useChatConnection.getState().refreshUsage();
    };
    const timer = window.setInterval(refresh, 60_000);
    window.addEventListener('focus', refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', refresh);
    };
  }, [connection.live]);
  const remaining = !connection.live
    ? '未连接 AI 工具'
    : connection.loadingUsage
      ? '正在读取 AI 用量…'
      : accountUsageSummary(connection.usage);
  const [loggingOut, setLoggingOut] = useState(false);
  return (
    <aside className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
      <div className="sidebar-heading">
        <span className="sidebar-wordmark">
          <AppLogo size={24} /> <strong>VoxCue</strong>
        </span>
        <Button
          className="sidebar-toggle-button"
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
          className="nav-item"
          aria-label="新对话"
          onClick={onNew}
          disabled={!preparation.chatsReady}
        >
          <MessageCirclePlus size={18} />
          <span>新对话</span>
          <span className="nav-create-symbol" aria-hidden="true">
            ＋
          </span>
        </button>
        <button
          className={`nav-item ${page === 'history' ? 'active' : ''}`}
          aria-label="面试记录"
          aria-current={page === 'history' ? 'page' : undefined}
          onClick={() => onNavigate('history')}
        >
          <History size={18} />
          <span>面试记录</span>
        </button>
        <button
          className={`nav-item ${page === 'knowledge' ? 'active' : ''}`}
          aria-label="知识库"
          aria-current={page === 'knowledge' ? 'page' : undefined}
          onClick={() => onNavigate('knowledge')}
        >
          <Database size={18} />
          <span>知识库</span>
        </button>
      </nav>
      {!collapsed && (
        <div className="sidebar-conversations">
          <p className="section-caption">聊天记录</p>
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
                  aria-current={
                    preparation.activeConversation === conversation.id && page === 'preparation'
                      ? 'page'
                      : undefined
                  }
                  aria-label={`${conversation.title}${conversation.messages.some((m) => m.status === 'streaming') ? '，正在回复' : conversation.unread ? '，回复完成，尚未查看' : ''}${!conversation.messages.length ? '，未发送草稿' : ''}`}
                  onClick={() => {
                    preparation.selectConversation(conversation.id);
                    onNavigate('preparation');
                  }}
                >
                  <span className="conversation-indicator" aria-hidden="true">
                    {conversation.messages.some((message) => message.status === 'streaming') ? (
                      <span className="conversation-spinner">
                        <Loader size={14} />
                      </span>
                    ) : (
                      <span
                        className={`conversation-dot ${conversation.unread ? 'is-unread' : ''}`}
                      />
                    )}
                  </span>
                  <span>
                    {conversation.title}
                    {!conversation.messages.length && <small> · 草稿</small>}
                  </span>
                </button>
                <ConfirmDeleteButton
                  iconOnly
                  compact
                  className="conversation-delete"
                  target={'对话：' + conversation.title}
                  revision={conversation.id + ':' + conversation.title}
                  active={!collapsed}
                  aria-label={'删除对话：' + conversation.title}
                  onConfirm={() => {
                    const active = preparation.activeConversation === conversation.id;
                    preparation.deleteConversation(conversation.id);
                    if (active) onNavigate('preparation');
                  }}
                />
              </div>
            ))}
        </div>
      )}
      <div className="sidebar-bottom">
        <div className="local-note">
          <div className="sidebar-status-row">
            <SidebarUpdate />
          </div>
          {!collapsed && connection.error && (
            <button className="status-retry" onClick={() => void connection.load(true, true)}>
              <Refresh size={14} />
              重新加载模型
            </button>
          )}
        </div>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button className="user-button" aria-label="用户菜单">
              <span className="avatar">{userName.slice(0, 1).toUpperCase()}</span>
              <span className="user-info">
                <strong title={accountLabel}>{accountLabel}</strong>
                <small>{remaining}</small>
              </span>
              <ChevronsUpDown size={15} />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              className="dropdown-content user-menu"
              side="top"
              align="start"
              sideOffset={8}
            >
              <DropdownMenu.Item className="dropdown-item" onSelect={onSettings}>
                <Settings size={16} />
                设置
              </DropdownMenu.Item>
              <DropdownMenu.Separator className="dropdown-separator" />
              <DropdownMenu.Item className="dropdown-item" onSelect={() => setLoggingOut(true)}>
                <LogOut size={16} />
                退出登录
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>
      {loggingOut && (
        <Modal title="退出登录" onClose={() => setLoggingOut(false)}>
          <p>
            退出后，正在生成的回复会停止，未保存的个人信息编辑会丢失。普通聊天、附件草稿和已保存资料会保留。
          </p>
          <div className="dialog-footer">
            <Button variant="outline" data-autofocus onClick={() => setLoggingOut(false)}>
              <X size={16} />
              取消
            </Button>
            <Button
              variant="dangerGhost"
              onClick={() => {
                setLoggingOut(false);
                onLogout();
              }}
            >
              <LogOut size={16} />
              退出登录
            </Button>
          </div>
        </Modal>
      )}
    </aside>
  );
}

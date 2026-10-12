import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
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
} from './icons';
import { Button } from './ui/button';
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
          <p className="section-caption">当前对话</p>
          <button onClick={() => onNavigate('preparation')} className="conversation">
            <span className="conversation-dot" />
            面试准备与练习
          </button>
        </div>
      )}
      <div className="sidebar-bottom">
        {!collapsed && (
          <div className="local-note">
            <span className="status-dot" />
            本地模拟环境
            <ArrowUpRight size={13} />
            <p>从容练习，清晰表达。</p>
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
    </aside>
  );
}

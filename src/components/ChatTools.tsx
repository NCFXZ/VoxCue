import { useRef } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Button } from './ui/button';
import { Check, X, Globe, Folder, Paperclip, Plus, ChevronDown, Sparkles } from './icons';
import { usePreparation } from '../stores/preparation';
import { chatFileAccept } from '../services/chatOptions';
import { useChatConnection } from '../stores/chatConnection';
export function ChatTools() {
  const state = usePreparation();
  const connection = useChatConnection();
  const models = connection.models;
  const selected = models.find((model) => model.id === state.modelId) ?? models[0];
  const files = useRef<HTMLInputElement>(null);
  const folder = useRef<HTMLInputElement>(null);
  return (
    <>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <Button type="button" variant="ghost" size="icon" aria-label="添加附件">
            <Plus size={16} />
          </Button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            className="dropdown-content"
            side="top"
            align="start"
            sideOffset={10}
          >
            <DropdownMenu.Item className="dropdown-item" onSelect={() => files.current?.click()}>
              <Paperclip size={16} />
              添加文件
            </DropdownMenu.Item>
            <DropdownMenu.Item className="dropdown-item" onSelect={() => folder.current?.click()}>
              <Folder size={16} />
              添加文件夹
            </DropdownMenu.Item>
            <DropdownMenu.Separator className="dropdown-separator" />
            <DropdownMenu.CheckboxItem
              className="dropdown-item"
              checked={state.webSearch}
              onCheckedChange={state.setWebSearch}
            >
              <Globe size={16} />
              网络搜索
              <span className="tool-menu-check">{state.webSearch && <Check size={14} />}</span>
            </DropdownMenu.CheckboxItem>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      <Button
        type="button"
        variant="ghost"
        className={state.webSearch ? 'search-enabled' : ''}
        aria-pressed={state.webSearch}
        onClick={() => state.setWebSearch(!state.webSearch)}
      >
        <Globe size={14} />
        网络搜索{!connection.live && <span className="tool-mock">模拟</span>}
      </Button>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <Button type="button" variant="ghost" className="model-trigger" aria-label="聊天模型">
            <span>{selected?.label ?? (connection.loading ? '加载模型…' : '模型不可用')}</span>
            {!connection.live && <span className="tool-mock">Mock</span>}
            <ChevronDown size={12} />
          </Button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            className="dropdown-content model-menu"
            side="top"
            align="start"
            sideOffset={10}
          >
            <DropdownMenu.Label className="model-menu-label">
              选择模型<span>{connection.live ? 'ChatGPT' : '模拟'}</span>
            </DropdownMenu.Label>
            <DropdownMenu.RadioGroup value={selected?.id} onValueChange={state.setModel}>
              {models.map((model) => (
                <DropdownMenu.RadioItem
                  className="dropdown-item model-option"
                  value={model.id}
                  key={model.id}
                >
                  <span className="model-option-icon">
                    <Sparkles size={16} />
                  </span>
                  <span>
                    <strong>{model.label}</strong>
                    <small>{model.description}</small>
                  </span>
                  <DropdownMenu.ItemIndicator className="model-check">
                    <Check size={15} />
                  </DropdownMenu.ItemIndicator>
                </DropdownMenu.RadioItem>
              ))}
            </DropdownMenu.RadioGroup>
            {connection.live && (
              <>
                {connection.error && (
                  <p className="model-error" role="alert">
                    {connection.error}
                  </p>
                )}
                <DropdownMenu.Separator className="dropdown-separator" />
                <DropdownMenu.Item
                  className="dropdown-item"
                  disabled={connection.loading}
                  onSelect={() => {
                    void connection.load(true, true);
                  }}
                >
                  {connection.loading ? '正在读取…' : '刷新模型列表'}
                </DropdownMenu.Item>
              </>
            )}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      <input
        ref={files}
        className="sr-only"
        type="file"
        multiple
        accept={chatFileAccept}
        aria-label="添加聊天文件"
        onChange={(event) => {
          state.addAttachments(Array.from(event.target.files || []));
          event.target.value = '';
        }}
      />
      <input
        ref={folder}
        className="sr-only"
        type="file"
        multiple
        {...{ webkitdirectory: '' }}
        aria-label="添加聊天文件夹"
        onChange={(event) => {
          state.addAttachments(Array.from(event.target.files || []));
          event.target.value = '';
        }}
      />
    </>
  );
}
export function ChatAttachments() {
  const state = usePreparation();
  return (
    <div className="chat-attachments">
      {state.attachments.map((item) => (
        <div className="chat-attachment" key={item.id}>
          <Paperclip size={14} />
          <span title={item.name}>
            {item.name}
            <small>{Math.ceil(item.size / 1024)} KB · 待发送</small>
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`移除附件 ${item.name}`}
            onClick={() => state.removeAttachment(item.id)}
          >
            <X size={13} />
          </Button>
        </div>
      ))}
    </div>
  );
}

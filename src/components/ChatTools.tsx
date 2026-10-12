import { useRef } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Button } from './ui/button';
import { Check, X, Globe, Folder, Paperclip, Plus } from './icons';
import { usePreparation } from '../stores/preparation';
import { chatModels, chatFileAccept } from '../services/chatOptions';
export function ChatTools() {
  const state = usePreparation();
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
        网络搜索<span className="tool-mock">模拟</span>
      </Button>
      <label className="model-picker">
        <span className="sr-only">聊天模型</span>
        <select
          aria-label="聊天模型"
          value={state.modelId}
          onChange={(event) => state.setModel(event.target.value)}
        >
          {chatModels.map((model) => (
            <option key={model.id} value={model.id}>
              {model.label} · Mock
            </option>
          ))}
        </select>
      </label>
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

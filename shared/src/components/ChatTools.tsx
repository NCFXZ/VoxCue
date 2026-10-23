import { useRef, type ReactNode } from 'react';
import * as DropdownMenu from './ui/dropdown-menu';
import { Button } from './ui/button';
import { ConfirmDeleteButton } from './ui/confirm-delete-button';
import { Check, Globe, Folder, Paperclip, Plus, ChevronDown, Refresh, Sparkles } from './icons';
import { usePreparation } from '../stores/preparation';
import { chatFileAccept, effortLabels } from '../services/chatOptions';
import type { ReasoningEffort } from '../../electron/contracts/chat';
import { useChatConnection } from '../stores/chatConnection';
import { useModelProvider } from './useModelProvider';
export function ChatTools({ actions }: { actions: ReactNode }) {
  const state = usePreparation();
  const connection = useChatConnection();
  const models = connection.models;
  const selected = models.find((model) => model.id === state.modelId) ?? models[0];
  const efforts = selected?.reasoningEfforts ?? [];
  const effort = efforts.includes(state.effort as ReasoningEffort) ? state.effort : 'auto';
  const files = useRef<HTMLInputElement>(null);
  const folder = useRef<HTMLInputElement>(null);
  return (
    <>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="添加附件"
            data-native-reveal-on-hover
            disabled={!state.chatsReady}
          >
            <Plus size={16} />
          </Button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            className="dropdown-content composer-menu"
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
              className="dropdown-item search-menu-item"
              checked={state.webSearch}
              onCheckedChange={state.setWebSearch}
            >
              <Globe size={16} />
              网络搜索
              <span className="tool-menu-check dropdown-check">
                {state.webSearch && <Check size={14} />}
              </span>
            </DropdownMenu.CheckboxItem>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      <div className="composer-model-tools">
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <Button
              type="button"
              variant="ghost"
              className="composer-tool model-trigger"
              aria-label="聊天模型"
              data-native-reveal-on-hover
            >
              <span>{selected?.label ?? (connection.loading ? '加载模型…' : '模型不可用')}</span>
              <ChevronDown size={12} />
            </Button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              className="dropdown-content compact-tool-menu composer-menu model-menu"
              side="top"
              align="start"
              sideOffset={10}
            >
              <DropdownMenu.RadioGroup value={selected?.id} onValueChange={state.setModel}>
                {models.map((model) => (
                  <DropdownMenu.RadioItem
                    className="dropdown-item model-option"
                    value={model.id}
                    key={model.id}
                  >
                    <span className="model-name">{model.label}</span>
                    <DropdownMenu.ItemIndicator className="model-check dropdown-check">
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
                    <Refresh size={16} />
                    {connection.loading ? '正在读取…' : '刷新模型列表'}
                  </DropdownMenu.Item>
                </>
              )}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <Button
              type="button"
              variant="ghost"
              className="composer-tool effort-trigger"
              aria-label="思考强度"
              data-native-reveal-on-hover
              disabled={!efforts.length}
            >
              <span className="effort-compact-icon">
                <Sparkles size={14} />
              </span>
              <span>
                <span className="effort-tool-label">思考强度 · </span>
                {effortLabels[effort]}
              </span>
              <ChevronDown size={12} />
            </Button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              className="dropdown-content compact-tool-menu composer-menu effort-menu"
              side="top"
              align="start"
              sideOffset={10}
            >
              <DropdownMenu.Label className="model-menu-label">思考强度</DropdownMenu.Label>
              <DropdownMenu.RadioGroup
                value={effort}
                onValueChange={(value) => state.setEffort(value as ReasoningEffort | 'auto')}
              >
                {['auto' as const, ...efforts].map((value) => (
                  <DropdownMenu.RadioItem className="dropdown-item" key={value} value={value}>
                    {effortLabels[value]}
                    <DropdownMenu.ItemIndicator className="tool-menu-check dropdown-check">
                      <Check size={14} />
                    </DropdownMenu.ItemIndicator>
                  </DropdownMenu.RadioItem>
                ))}
              </DropdownMenu.RadioGroup>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>
      {actions}
      <input
        ref={files}
        className="sr-only"
        type="file"
        multiple
        accept={chatFileAccept}
        aria-label="添加聊天文件"
        disabled={!state.chatsReady}
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
        disabled={!state.chatsReady}
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
  const provider = useModelProvider();
  return (
    <div className="chat-attachments">
      {state.attachments.map((item) => (
        <div className="chat-attachment" key={item.id}>
          <Paperclip size={14} />
          <span>
            {item.name}
            <small>
              {Math.ceil(item.size / 1024)} KB · 本次附件 · 待发送至 {provider.dataRecipient}
            </small>
          </span>
          <ConfirmDeleteButton
            iconOnly
            label="移除"
            target={'附件：' + item.name}
            revision={item.id}
            aria-label={'移除附件 ' + item.name}
            warning="将移除本次待发送附件，原文件会保留"
            onConfirm={() => state.removeAttachment(item.id)}
          />
        </div>
      ))}
    </div>
  );
}

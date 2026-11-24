import { t } from '../i18n';
import { useRef, type ReactNode } from 'react';
import * as DropdownMenu from './ui/dropdown-menu';
import { Button } from './ui/button';
import { ConfirmDeleteButton } from './ui/confirm-delete-button';
import { AnimatedCollection } from './ui/AnimatedCollection';
import { Folder, Paperclip, Plus } from './icons';
import { usePreparation } from '../stores/preparation';
import { chatFileAccept } from '../services/chatOptions';
import { ModelReasoningControl } from './ReasoningEffortControl';
import { useChatConnection } from '../stores/chatConnection';
import { useAuth } from '../stores/auth';
import { useModelProvider } from './useModelProvider';
export function ChatTools({ actions }: { actions: ReactNode }) {
  const state = usePreparation();
  const connection = useChatConnection();
  const resolved = useAuth((state) => state.resolved);
  const authError = useAuth((state) => state.error);
  const models = connection.models;
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
            aria-label={t('添加附件')}
            data-reveal-on-hover
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
              {t('添加文件')}
            </DropdownMenu.Item>
            <DropdownMenu.Item className="dropdown-item" onSelect={() => folder.current?.click()}>
              <Folder size={16} />
              {t('添加文件夹')}
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      <div className="composer-model-tools">
        <ModelReasoningControl
          revealOnHover
          models={models}
          modelId={state.modelId}
          onModelChange={state.setModel}
          effort={state.effort}
          onEffortChange={state.setEffort}
          loading={connection.loading}
          onRequestModels={resolved ? undefined : useAuth.getState().ensure}
          error={connection.error || authError}
          onRefresh={
            connection.live
              ? () => {
                  void connection.load(true, true);
                }
              : resolved ? undefined : useAuth.getState().ensure
          }
          className="composer-tool model-trigger effort-model-trigger"
        />
      </div>
      {actions}
      <input
        ref={files}
        className="sr-only"
        type="file"
        multiple
        accept={chatFileAccept}
        aria-label={t('添加聊天文件')}
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
        aria-label={t('添加聊天文件夹')}
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
    <AnimatedCollection className="chat-attachments" wrapped enabled={state.chatsReady}>
      {state.attachments.map((item) => (
        <div className="chat-attachment" key={item.name} data-motion-revision={item.id}>
          <Paperclip size={14} />
          <span>
            {item.name}
            <small>
              {Math.ceil(item.size / 1024)}
              {t(' KB · 本次附件 · 待发送至 ')}
              {provider.dataRecipient}
            </small>
          </span>
          <ConfirmDeleteButton
            iconOnly
            label={t('移除')}
            target={t('附件：') + item.name}
            revision={item.id}
            aria-label={t('移除附件 ') + item.name}
            warning={t('将移除本次待发送附件，原文件会保留')}
            onConfirm={() => state.removeAttachment(item.id)}
          />
        </div>
      ))}
    </AnimatedCollection>
  );
}

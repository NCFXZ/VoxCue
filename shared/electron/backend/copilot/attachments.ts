import type { MessageOptions } from '@github/copilot-sdk';
import type { Message } from 'vscode-jsonrpc/node';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { setImmediate as yieldToIO } from 'node:timers/promises';
import type { ChatRequest } from '../../contracts/chat';
import { base64Chunks } from '../chat/input';
import { CopilotError } from './errors';

export const copilotAttachmentMime: Readonly<Record<string, string>> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};

type Attachments = NonNullable<MessageOptions['attachments']>;
interface Frame {
  fields: Map<object, { key: 'data' | 'text'; parts: string[] }>;
  bytes: number;
  signal: AbortSignal;
}
// A request still queued in the SDK writer retains its cancellation signal.
// Once the SDK releases its attachments the registration can be collected.
const frames = new WeakMap<Attachments, Frame>();

export async function copilotAttachments(turns: ChatRequest['turns'], signal: AbortSignal) {
  const files = turns.flatMap(turn => turn.files ?? []);
  // JSON can expand a single text control character into a six-byte escape.
  const estimatedSize = files.reduce((size, file) => size + (/\.(md|txt)$/i.test(file.name)
    ? file.bytes.byteLength * 6 : Math.ceil(file.bytes.byteLength / 3) * 4), 0);
  const large = estimatedSize >= 4 * 1024 * 1024;
  const attachments: Attachments = [];
  const frame: Frame = { fields: new Map(), bytes: 0, signal };
  for (const file of files) {
    signal.throwIfAborted();
    const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
    if (extension === 'txt' || extension === 'md') {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(file.bytes);
      if (text.length > 200000) throw new CopilotError('文本附件内容过长，请缩短后再发送。');
      const attachment = { type: 'selection' as const, filePath: file.name, displayName: file.name, text };
      attachments.push(attachment);
      if (large) {
        const parts: string[] = [];
        for (let start = 0; start < text.length;) {
          let end = Math.min(start + 32 * 1024, text.length);
          const last = text.charCodeAt(end - 1);
          if (end < text.length && last >= 0xd800 && last <= 0xdbff) end--;
          const escaped = JSON.stringify(text.slice(start, end)).slice(1, -1);
          parts.push(escaped);
          frame.bytes += Buffer.byteLength(escaped);
          start = end;
          await yieldToIO();
          signal.throwIfAborted();
        }
        frame.fields.set(attachment, { key: 'text', parts });
      }
    } else if (copilotAttachmentMime[extension]) {
      let data = '';
      const parts: string[] = [];
      for await (const chunk of base64Chunks(file.bytes, signal)) {
        data += chunk;
        if (large) parts.push(chunk);
      }
      const attachment = { type: 'blob' as const, data, mimeType: copilotAttachmentMime[extension], displayName: file.name };
      attachments.push(attachment);
      if (large) {
        frame.fields.set(attachment, { key: 'data', parts });
        frame.bytes += data.length;
      }
    } else throw new CopilotError('Copilot 不支持该附件格式。');
  }
  signal.throwIfAborted();
  if (large) frames.set(attachments, frame);
  return attachments;
}

async function encodeFrame(message: Message, frame: Frame) {
  frame.signal.throwIfAborted();
  const token = randomUUID();
  const slots: string[][] = [];
  const envelope = JSON.stringify(message, function (key, value) {
    const field = frame.fields.get(this);
    if (field?.key !== key) return value;
    slots.push(field.parts);
    return token;
  });
  // Keep JSON.stringify's exact escaping, field order and quotes. Only the
  // contents of our own attachment fields are filled from previously encoded chunks.
  const sections = envelope.split(token);
  if (sections.length !== slots.length + 1 || slots.length !== frame.fields.size)
    throw new CopilotError('附件请求无效。');
  const bytes = Buffer.allocUnsafe(Buffer.byteLength(envelope) - slots.length * token.length + frame.bytes);
  let offset = 0;
  for (let i = 0; i < sections.length; i++) {
    offset += bytes.write(sections[i], offset, 'utf8');
    for (const part of slots[i] ?? []) {
      offset += bytes.write(part, offset, 'utf8');
      await yieldToIO();
      frame.signal.throwIfAborted();
    }
  }
  if (offset !== bytes.length) throw new CopilotError('附件请求无效。');
  return bytes;
}

let installed = false;
export function installCopilotAttachmentEncoder() {
  if (installed) return;
  // Resolve the public JSON-RPC API from the installed SDK, including in ASAR.
  // Writers capture their RAL encoder at construction, before session.send.
  const sdk = createRequire(createRequire(__filename).resolve('@github/copilot-sdk'));
  const { RAL } = sdk('vscode-jsonrpc/node.js') as typeof import('vscode-jsonrpc/node');
  const previous = RAL();
  const encoder = previous.applicationJson.encoder;
  RAL.install({ ...previous, applicationJson: { ...previous.applicationJson, encoder: {
    ...encoder,
    encode(message, options) {
      const request = message as Message & {
        id?: number;
        method?: string;
        params?: { attachments?: Attachments; sessionId?: string };
      };
      const frame = request.method === 'session.send' && request.params?.attachments &&
        frames.get(request.params.attachments);
      if (!frame || options.charset !== 'utf-8') return encoder.encode(message, options);
      return encodeFrame(message, frame).catch(error => {
        if (!frame.signal.aborted || error !== frame.signal.reason ||
          typeof request.id !== 'number' || typeof request.params?.sessionId !== 'string') throw error;
        // The pinned JSON-RPC writer rethrows a rejected encode outside sendRequest's
        // promise. Complete the reserved frame with the SDK's session-local abort RPC.
        const cancel = {
          jsonrpc: '2.0', id: request.id, method: 'session.abort',
          params: { sessionId: request.params.sessionId },
        };
        return encoder.encode(cancel, options);
      });
    },
  } } });
  installed = true;
}

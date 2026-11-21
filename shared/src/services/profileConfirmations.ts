import { profileStorageKey } from './storedValues';
import type { ChatMessage } from './preparation';
import { storedMessage, type PreparationConversation } from './chats';
import { profileFields, type ProfileField } from '../../electron/contracts/profile';

// A short-lived receipt bridges synchronous profile storage and the account's chat transaction.
const key = 'voxcue-pending-profile-confirmations-v1';
interface Confirmation {
  conversation: string;
  message: string;
  fields: ProfileField[];
  skills?: string[];
  proposal?: ChatMessage;
  expectedProfile?: string;
}
function receipts(storage: Storage, raw = storage.getItem(key)): Confirmation[] {
  if (!raw) return [];
  const rows = JSON.parse(raw);
  if (
    !Array.isArray(rows) ||
    !rows.every(
      (row) =>
        row &&
        typeof row.conversation === 'string' &&
        typeof row.message === 'string' &&
        Array.isArray(row.fields) &&
        row.fields.length > 0 &&
        row.fields.every((field: ProfileField) => profileFields.includes(field)) &&
        (row.expectedProfile === undefined || typeof row.expectedProfile === 'string') &&
        (row.proposal === undefined ||
          (storedMessage(row.proposal) &&
            row.proposal.id === row.message &&
            row.proposal.role === 'assistant' &&
            row.proposal.status === 'completed' &&
            !row.proposal.options)) &&
        (row.skills === undefined ||
          (Array.isArray(row.skills) &&
            row.skills.length <= 20 &&
            row.skills.every((id: unknown) => typeof id === 'string' && /^[\w-]{1,64}$/.test(id)))),
    )
  )
    throw Error('资料确认记录无法读取。');
  return rows
    .filter(
      (row) =>
        row.expectedProfile === undefined ||
        row.expectedProfile === storage.getItem(profileStorageKey),
    )
    .map(({ expectedProfile, ...row }) => row);
}
export function confirmedMessage(
  message: ChatMessage,
  fields: ProfileField[],
  skills?: string[],
): ChatMessage {
  return {
    ...message,
    applied: true,
    selectedProfileFields: fields,
    appliedProfileFields: fields,
    ...(fields.includes('skills') ? { selectedSkillIds: skills, appliedSkillIds: skills } : {}),
    error: undefined,
  };
}
export function saveConfirmedProfile(storage: Storage, profile: string, receipt: Confirmation) {
  const previous = storage.getItem(profileStorageKey);
  const existing = receipts(storage);
  // A crash between either pair of writes can be resolved against the exact profile value.
  storage.setItem(key, JSON.stringify([...existing, { ...receipt, expectedProfile: profile }]));
  try {
    storage.setItem(profileStorageKey, profile);
    storage.setItem(key, JSON.stringify([...existing, receipt]));
  } catch (error) {
    if (storage.getItem(profileStorageKey) !== previous) {
      if (previous == null) storage.removeItem(profileStorageKey);
      else storage.setItem(profileStorageKey, previous);
    }
    if (existing.length) storage.setItem(key, JSON.stringify(existing));
    else storage.removeItem(key);
    throw error;
  }
}
export function recoverConfirmations(storage: Storage, conversations: PreparationConversation[]) {
  const pending = receipts(storage);
  if (!pending.length) return conversations;
  return conversations.map((conversation) => {
    const own = pending.filter((row) => row.conversation === conversation.id);
    if (!own.length) return conversation;
    const messages = conversation.messages.map((previous) => {
      const row = own.find((receipt) => receipt.message === previous.id);
      if (!row || previous.role !== 'assistant' || previous.dismissed || previous.applied)
        return previous;
      const message =
        previous.status === 'stopped' && previous.startedAt === row.proposal?.startedAt
          ? (row.proposal ?? previous)
          : previous;
      if (message.status !== 'completed' || !message.changes) return previous;
      const next = confirmedMessage(message, row.fields, row.skills);
      return storedMessage(next) ? next : previous;
    });
    return { ...conversation, messages };
  });
}
export function acknowledgeConfirmations(
  storage: Storage,
  saved: PreparationConversation[],
  current: PreparationConversation[],
) {
  const raw = storage.getItem(key);
  if (!raw) return;
  const pending = receipts(storage, raw);
  const remaining = pending.filter((row) => {
    const find = (list: PreparationConversation[]) =>
      list
        .find((conversation) => conversation.id === row.conversation)
        ?.messages.find((message) => message.id === row.message);
    const message = find(saved);
    return !message?.applied && !!find(current)?.applied;
  });
  if (remaining.length) storage.setItem(key, JSON.stringify(remaining));
  else storage.removeItem(key);
}

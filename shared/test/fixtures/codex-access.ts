import type { OpenAIAccess } from '../../electron/backend/chat/models';

export function codexAccess(account = 'client:subject', token = 'synthetic-' + account): OpenAIAccess {
  return {
    kind: 'codex',
    account,
    chatgptAccountId: account.split(':').at(-1)!,
    token,
    runtimeVersion: '1.2.3',
  };
}

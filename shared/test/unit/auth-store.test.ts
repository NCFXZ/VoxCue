import { beforeEach, expect, it, vi } from 'vitest';
import type { AccountConnection, AccountService, AuthSession } from '../../electron/contracts/auth';

const ports = vi.hoisted(() => ({
  session: vi.fn(), signIn: vi.fn(), signOut: vi.fn(), disable: vi.fn(),
  accounts: vi.fn(), cancel: vi.fn(), load: vi.fn(), clearSavedUsage: vi.fn(),
}));
vi.mock('../../src/services/auth', () => ({ authentication: ports }));
vi.mock('../../src/stores/chatConnection', () => ({
  useChatConnection: { getState: () => ({ load: ports.load, clearSavedUsage: ports.clearSavedUsage }) },
}));
vi.mock('../../src/services/serviceModelPreferences', () => ({ startServiceModelSwitch: vi.fn() }));

const session = (mode: AccountService): AuthSession => ({
  mode, user: { id: 'synthetic-' + mode, name: 'Synthetic', email: '' }, expiresAt: null,
});
const connection = (service: AccountService): AccountConnection => ({ service, name: 'Synthetic', email: '' });
beforeEach(() => { vi.resetModules(); vi.resetAllMocks(); });

it('disables use without signing out and reuses a saved session on enable', async () => {
  const { useAuth } = await import('../../src/stores/auth');
  useAuth.setState({ session: session('chatgpt'), accounts: ['chatgpt'], resolved: true });
  ports.accounts.mockResolvedValue([connection('chatgpt')]);
  expect(await useAuth.getState().disable()).toBe(true);
  expect(useAuth.getState()).toMatchObject({ session: null, accounts: ['chatgpt'], waiting: false });
  expect(ports.signOut).not.toHaveBeenCalled();
  expect(ports.load).toHaveBeenLastCalledWith(false, false, undefined);
  ports.session.mockResolvedValue(session('chatgpt'));
  ports.accounts.mockResolvedValue([connection('chatgpt')]);
  await useAuth.getState().connect('chatgpt');
  expect(useAuth.getState().session?.mode).toBe('chatgpt');
  expect(ports.signIn).not.toHaveBeenCalled();
});
it('keeps the active session and both accounts when disable fails', async () => {
  const { useAuth } = await import('../../src/stores/auth');
  useAuth.setState({ session: session('chatgpt'), accounts: ['chatgpt', 'copilot'] });
  ports.disable.mockRejectedValue(Error('synthetic failure'));
  expect(await useAuth.getState().disable()).toBe(false);
  expect(useAuth.getState()).toMatchObject({
    session: session('chatgpt'), accounts: ['chatgpt', 'copilot'], error: 'synthetic failure',
  });
  expect(ports.load).not.toHaveBeenCalled();
});
it('signs out an inactive account without clearing the active provider or its model state', async () => {
  const { useAuth } = await import('../../src/stores/auth');
  useAuth.setState({ session: session('copilot'), accounts: ['chatgpt', 'copilot'] });
  ports.signOut.mockResolvedValue({ warning: null });
  ports.accounts.mockResolvedValue([connection('copilot')]);
  expect(await useAuth.getState().signOut('chatgpt')).toBe(true);
  expect(ports.signOut).toHaveBeenCalledExactlyOnceWith('chatgpt');
  expect(useAuth.getState()).toMatchObject({ session: session('copilot'), accounts: ['copilot'] });
  expect(ports.load).not.toHaveBeenCalled();
});
it('does not let a late account listing restore a signed-out service', async () => {
  const { useAuth } = await import('../../src/stores/auth');
  useAuth.setState({ session: session('copilot'), accounts: ['chatgpt', 'copilot'] });
  let finish!: (accounts: AccountConnection[]) => void;
  ports.accounts.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
    .mockResolvedValueOnce([connection('copilot')]);
  const older = useAuth.getState().loadAccounts();
  ports.signOut.mockResolvedValue({ warning: null });
  await useAuth.getState().signOut('chatgpt');
  finish([connection('chatgpt'), connection('copilot')]);
  await older;
  expect(useAuth.getState().accounts).toEqual(['copilot']);
  expect(useAuth.getState().accountUsers).toEqual({ copilot: { name: 'Synthetic', email: '' } });
});

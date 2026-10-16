import type { KnowledgeCoordinator } from '../application/knowledge';
import { validateKnowledge, safeKnowledgeError } from '../application/knowledge';
import { handleDesktop } from './handle';
export function registerKnowledgeIpc(
  coordinator: KnowledgeCoordinator,
  requireMain: (event: Electron.IpcMainInvokeEvent) => void,
) {
  handleDesktop('knowledge:call', async (event, value: unknown) => {
    requireMain(event);
    if (event.senderFrame !== event.sender.mainFrame) throw Error('Unauthorized frame');
    try {
      return { ok: true, value: await coordinator.call(validateKnowledge(value)) };
    } catch (error) {
      return { ok: false, error: safeKnowledgeError(error) };
    }
  });
}

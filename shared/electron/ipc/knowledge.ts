import type { KnowledgeCoordinator } from '../application/knowledge';
import { validateKnowledge, safeKnowledgeError } from '../application/knowledge';
import { handleDesktop } from './handle';
export function registerKnowledgeIpc(
  coordinator: KnowledgeCoordinator,
  requireMain: (event: Electron.IpcMainInvokeEvent) => void,
  requireModel: () => void = () => {},
) {
  handleDesktop('knowledge:call', async (event, value: unknown) => {
    requireMain(event);
    if (event.senderFrame !== event.sender.mainFrame) throw Error('Unauthorized frame');
    try {
      const call = validateKnowledge(value);
      if (call.op === 'import' || call.op === 'search') requireModel();
      return { ok: true, value: await coordinator.call(call) };
    } catch (error) {
      return { ok: false, error: safeKnowledgeError(error) };
    }
  });
}

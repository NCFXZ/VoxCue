import type { KnowledgeCoordinator } from '../application/knowledge';
import { validateKnowledge, safeKnowledgeError } from '../application/knowledge';
import { handleDesktop } from './handle';
export function registerKnowledgeIpc(
  coordinator: Pick<KnowledgeCoordinator, 'call'>,
  requireMain: (event: Electron.IpcMainInvokeEvent) => void,
  requireModel: () => void = () => {},
) {
  handleDesktop('knowledge:call', async (event, value: unknown) => {
    requireMain(event);
    if (event.senderFrame !== event.sender.mainFrame) throw Error('Unauthorized frame');
    try {
      const call = validateKnowledge(value);
      if (call.op === 'import' || call.op === 'search' || call.op === 'begin-index-batch') requireModel();
      return { ok: true, value: await coordinator.call(call) };
    } catch (error) {
      return { ok: false, error: safeKnowledgeError(error) };
    }
  });
}

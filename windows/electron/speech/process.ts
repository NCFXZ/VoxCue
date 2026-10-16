import { SpeechController } from './controller';
const port = process.parentPort!;
let controller: SpeechController;
port.on('message', async ({ data: m }) => {
  try {
    if (m.init)
      controller = new SpeechController(m.model, m.helper, (event) => port.postMessage({ event }));
    const value = m.init ? undefined : await controller.call(m.call);
    port.postMessage({ id: m.id, value });
  } catch (error) {
    port.postMessage({ id: m.id, error: (error as Error).message });
  }
});
process.on('SIGTERM', () => {
  void controller?.close().finally(() => process.exit(0));
});

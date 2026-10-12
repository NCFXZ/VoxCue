// Explicit opt-in only: this test uses the user's saved ChatGPT authorization and plan usage.
import { _electron as electron } from 'playwright';
if (!process.argv.includes('--live'))
  throw new Error('Append --live to use the saved account and real ChatGPT usage.');
const app = await electron.launch({
  args: ['.'],
  env: { ...process.env, VITE_DEV_SERVER_URL: '', COPILOT_TEST_USER_DATA: '' },
});
try {
  const page = await app.firstWindow();
  await page.waitForFunction(() => !!window.desktop);
  const session = await page.evaluate(() => window.desktop.authSession());
  if (session?.mode !== 'chatgpt') {
    console.log('SKIP: no saved ChatGPT session. User must complete browser login.');
  } else {
    const catalog = await page.evaluate(() => window.desktop.chatModels(true));
    if (!catalog.ok) console.log('LIVE MODELS FAILED:', JSON.stringify(catalog.error));
    else {
      console.log('LIVE MODELS:', catalog.models.map((model) => model.label).join(', '));
      for (const webSearch of [false, true]) {
        const result = await page.evaluate(
          async ({ modelId, webSearch }) => {
            let deltaCount = 0;
            const unsubscribe = window.desktop.onChatEvent((event) => {
              if (event.type === 'delta') deltaCount++;
            });
            try {
              const result = await window.desktop.chatSend({
                id: crypto.randomUUID(),
                modelId,
                webSearch,
                instructions: 'Keep the answer brief.',
                turns: [
                  {
                    role: 'user',
                    content: webSearch
                      ? 'Find the official OpenAI website and cite its URL in one sentence.'
                      : 'Reply with exactly: connection verified',
                  },
                ],
              });
              return { result, deltaCount };
            } finally {
              unsubscribe();
            }
          },
          { modelId: catalog.models[0].id, webSearch },
        );
        console.log(webSearch ? 'LIVE SEARCH:' : 'LIVE CHAT:', JSON.stringify(result));
      }
    }
  }
} finally {
  await app.close();
}

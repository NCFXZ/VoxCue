// Playwright waitForFunction treats a Promise as truthy before its boolean
// resolves. Poll IPC/IndexedDB predicates in the runner and await each result.
export async function waitForAsync(page, predicate, argument, { timeout = 30000 } = {}) {
  const deadline = performance.now() + timeout;
  do {
    let timer;
    let result;
    try {
      result = await Promise.race([
        page.evaluate(predicate, argument),
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(Error('Asynchronous page evaluation timed out')),
            Math.max(0, deadline - performance.now()),
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 50));
  } while (performance.now() < deadline);
  throw Error(`Asynchronous page condition did not become true within ${timeout}ms`);
}

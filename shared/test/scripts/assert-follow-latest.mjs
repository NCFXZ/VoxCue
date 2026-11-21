import assert from 'node:assert/strict';

// Check the visible scroll position on animation frames, including the final frame.
export async function assertSmoothFollow(scroller, button) {
  const start = await scroller.evaluate((node) => ({
    top: node.scrollTop, remaining: node.scrollHeight - node.clientHeight - node.scrollTop,
  }));
  assert.ok(start.top > 0 && start.remaining > 100, 'The reader starts partway down a long pane');
  const [movedThroughContent] = await Promise.all([
    scroller.evaluate(async (node, startTop) => {
      const deadline = performance.now() + 5000;
      let intermediate = false;
      do {
        await new Promise(requestAnimationFrame);
        const bottom = node.scrollHeight - node.clientHeight;
        if (node.scrollTop >= bottom - 1) return intermediate;
        if (node.scrollTop > startTop + 1) intermediate = true;
      } while (performance.now() < deadline);
      throw Error('The return-to-latest button did not reach the bottom');
    }, start.top),
    button.click(),
  ]);
  assert.ok(movedThroughContent, 'The return-to-latest button shows intermediate content');
}

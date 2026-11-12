import { expect, it, vi } from 'vitest';
import { boundedJson } from '../../electron/backend/boundedJson';

it.each(['pending', 'rejected'])(
  '超限响应立即失败，底层取消 %s 不延迟或替换原错误',
  async (cleanup) => {
    const cancel = vi.fn(() =>
      cleanup === 'pending'
        ? new Promise<void>(() => {})
        : Promise.reject(Error('synthetic transport cleanup failure')),
    );
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(5));
        },
        cancel,
      }),
    );
    await expect(boundedJson(response, 4)).rejects.toThrow('Oversized response');
    expect(cancel).toHaveBeenCalledOnce();
    expect(response.body!.locked).toBe(false);
  },
);

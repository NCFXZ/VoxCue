import { expect, it, vi } from 'vitest';
import { abortable } from '../../electron/backend/cancellable';

it('预先取消仍消费已启动端口的拒绝，只返回取消原因', async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(
    abortable(Promise.reject(Error('synthetic late failure')), controller.signal),
  ).rejects.toBe(controller.signal.reason);
});

it('取消后立即释放监听，端口迟到完成不能覆盖已取消结果', async () => {
  const controller = new AbortController();
  const remove = vi.spyOn(controller.signal, 'removeEventListener');
  let complete!: (value: string) => void;
  const pending = abortable(
    new Promise<string>((resolve) => {
      complete = resolve;
    }),
    controller.signal,
  );
  controller.abort();
  await expect(pending).rejects.toBe(controller.signal.reason);
  expect(remove).toHaveBeenCalledOnce();
  complete('retired result');
  await expect(pending).rejects.toBe(controller.signal.reason);
});

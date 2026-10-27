import { CloudAccountClient, CloudFailure } from './client';
import {
  validCloudSyncCall,
  type CloudSyncCall,
  type CloudSyncResult,
} from '../../contracts/cloudSync';

/** Narrow IPC-to-HTTP adapter. Credentials and URLs never cross the preload. */
export class CloudSyncClient {
  private busy = false;
  constructor(
    private account: CloudAccountClient,
    private restoreImage?: (id: string, bytes: Uint8Array, preview: string) => Promise<void>,
  ) {}
  async call(input: CloudSyncCall): Promise<CloudSyncResult> {
    if (this.busy)
      return {
        ok: false,
        error: '同步传输正在进行，请稍后重试。',
        status: 503,
        retryAfterSeconds: 1,
      };
    this.busy = true;
    try {
      if (!validCloudSyncCall(input)) throw new CloudFailure('同步请求无效。', 400);
      if (input.userId !== this.account.snapshot().user?.id)
        throw new CloudFailure('账号已变化，请重新打开同步设置。', 401);
      const r = '/v1/backups/',
        u = '/v1/uploads/';
      let value: unknown;
      switch (input.action) {
        case 'restoreImage':
          if (!this.restoreImage) throw new CloudFailure('截图恢复不可用。');
          await this.restoreImage(input.id, input.bytes, input.preview);
          value = { restored: true };
          break;
        case 'list':
          value = await this.account.api(
            '/v1/backups' + (input.cursor ? '?cursor=' + input.cursor : ''),
          );
          break;
        case 'create':
          value = await this.account.api('/v1/backups', 'POST', {
            id: input.id,
            kind: input.kind,
            name: input.key,
          });
          break;
        case 'begin':
          value = await this.account.api(r + input.id + '/uploads', 'POST', {
            requestId: input.requestId,
            bytes: input.bytes,
            sha256: input.sha256,
            baseRevision: input.revision,
          });
          break;
        case 'put':
          value = await this.account.api(
            u + input.id + '/parts/' + input.index,
            'PUT',
            input.bytes,
          );
          break;
        case 'complete':
          value = await this.account.api(u + input.id + '/complete', 'POST', {});
          break;
        case 'abort':
          value = await this.account.api(u + input.id, 'DELETE');
          break;
        case 'upload':
          value = await this.account.api(u + input.id);
          break;
        case 'versions':
          value = await this.account.api(r + input.id + '/versions');
          break;
        case 'manifest':
          value = await this.account.api(r + input.id + '/versions/' + input.version + '/manifest');
          break;
        case 'read':
          value = await this.account.api(
            r + input.id + '/versions/' + input.version + '/parts/' + input.index,
            'GET',
            undefined,
            true,
          );
          break;
        case 'remove':
          value = await this.account.api(r + input.id + '/remove', 'POST', {
            revision: input.revision,
          });
          break;
        case 'prune':
          value = await this.account.api(r + input.id + '/versions/' + input.version, 'DELETE');
          break;
      }
      return { ok: true, value };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof CloudFailure ? error.message : '同步连接失败，请检查网络。',
        status: error instanceof CloudFailure ? error.status : 0,
        ...(error instanceof CloudFailure && error.retryAfterSeconds
          ? { retryAfterSeconds: error.retryAfterSeconds }
          : {}),
      };
    } finally {
      this.busy = false;
    }
  }
}

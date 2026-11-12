import { spawn } from 'node:child_process';
import type { CredentialEncryption } from '../../shared/electron/backend/auth/storage';

// Only the trusted main process supplies this fixed native resource path.
// The native helper authenticates its signed parent before touching Keychain.
export function createCredentialEncryption(executable: string): CredentialEncryption {
  function run(operation: 'encrypt' | 'decrypt', value: Buffer): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const child = spawn(executable, [], {
        stdio: ['pipe', 'pipe', 'pipe'],
        // Security.framework selects the current OS user's Keychain. No shell,
        // Node, DYLD, profile or authentication environment reaches this fixed
        // legacy binary; its exact bytes/CDHash and existing ACL stay intact.
        env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin' },
      });
      const output: Buffer[] = [];
      let size = 0;
      let diagnostic = '';
      const timer = setTimeout(() => child.kill(), 120000);
      child.stdout.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > 2 * 1024 * 1024) child.kill();
        else output.push(chunk);
      });
      child.stderr.on('data', (chunk: Buffer) => {
        if (diagnostic.length < 512) diagnostic += chunk.toString('utf8');
      });
      child.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.stdin.on('error', () => {}); // Exit/denial is reported by close.
      child.once('close', (code) => {
        clearTimeout(timer);
        if (code !== 0) {
          const denied = /\(-128\)|\(-25293\)|\(-25308\)/.test(diagnostic);
          reject(
            Error(
              denied
                ? 'macOS 钥匙串访问未获允许，登录信息保持原样，请允许后重试。'
                : 'macOS 凭据加密助手不可用，登录信息保持原样，请重新启动或修复应用。',
            ),
          );
          return;
        }
        try {
          const reply = JSON.parse(Buffer.concat(output).toString('utf8'));
          if (
            typeof reply.data !== 'string' ||
            !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(reply.data)
          )
            throw Error('Invalid credential helper response');
          resolve(Buffer.from(reply.data, 'base64'));
        } catch {
          reject(Error('macOS 凭据加密助手返回无效，登录信息未更改。'));
        }
      });
      child.stdin.end(JSON.stringify({ operation, data: value.toString('base64') }));
    });
  }
  return {
    encrypt: (value) => run('encrypt', Buffer.from(value, 'utf8')),
    decrypt: async (value) => (await run('decrypt', value)).toString('utf8'),
  };
}

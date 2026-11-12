import { execFileSync } from 'node:child_process';
import { lstat, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';

/** A test-only VM attestation. Never used by the application or owner launcher. */
export async function requireGuestIsolation() {
  const file = process.env.VOXCUE_TEST_GUEST_CONTEXT;
  if (process.platform !== 'darwin' || !file || !path.isAbsolute(file))
    throw Error('Production package execution requires the disposable macOS guest runner.');
  const root = path.dirname(file),
    info = await lstat(file),
    directory = await lstat(root);
  if (
    !path.basename(root).startsWith('voxcue-macos-guest-') ||
    !directory.isDirectory() ||
    directory.isSymbolicLink() ||
    directory.uid !== process.getuid() ||
    (directory.mode & 0o777) !== 0o700 ||
    (await realpath(root)) !== root ||
    !info.isFile() ||
    info.isSymbolicLink() ||
    info.uid !== process.getuid() ||
    info.nlink !== 1 ||
    (info.mode & 0o777) !== 0o600 ||
    info.size > 4096
  )
    throw Error('Invalid owned guest execution context');
  const context = JSON.parse(await readFile(file, 'utf8'));
  const virtualized = execFileSync('/usr/sbin/sysctl', ['-n', 'kern.hv_vmm_present'], {
    encoding: 'utf8',
    timeout: 5000,
  }).trim();
  const hardware = execFileSync('/usr/sbin/ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice'], {
    encoding: 'utf8',
    timeout: 5000,
  });
  const uuid = hardware.match(/"IOPlatformUUID"\s*=\s*"([A-Fa-f0-9-]+)"/)?.[1];
  if (
    virtualized !== '1' ||
    context.version !== 1 ||
    !/^[a-f0-9]{32}$/.test(context.nonce ?? '') ||
    context.guestUID !== process.getuid() ||
    context.root !== root ||
    !uuid ||
    context.guestMachineUUID !== uuid ||
    context.hostMachineUUID === uuid ||
    !/^[A-Fa-f0-9-]{36}$/.test(context.hostMachineUUID ?? '')
  )
    throw Error('Guest identity does not match the disposable VM attestation');
  return context;
}

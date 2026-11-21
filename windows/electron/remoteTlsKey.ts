import { execFile } from 'node:child_process';
import path from 'node:path';

// Read and return bytes through anonymous pipes. The system process receives only a fixed command line.
const unprotect = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$inputBytes = [IO.MemoryStream]::new()
[Console]::OpenStandardInput().CopyTo($inputBytes)
$plain = [Security.Cryptography.ProtectedData]::Unprotect($inputBytes.ToArray(), $null, 'CurrentUser')
$certificates = [Security.Cryptography.X509Certificates.X509Certificate2Collection]::new()
try {
  $certificates.Import($plain, '', [Security.Cryptography.X509Certificates.X509KeyStorageFlags]::EphemeralKeySet)
  $leaves = @($certificates | Where-Object { $_.HasPrivateKey })
  if ($leaves.Count -ne 1) { throw 'Invalid TLS identity' }
  $outputStream = [Console]::OpenStandardOutput()
  $outputStream.Write([BitConverter]::GetBytes([int]$certificates.Count), 0, 4)
  $sha = [Security.Cryptography.SHA256]::Create()
  try {
    $outputStream.Write($sha.ComputeHash($leaves[0].RawData), 0, 32)
    foreach ($cert in $certificates) {
      if (!$cert.HasPrivateKey) { $outputStream.Write($sha.ComputeHash($cert.RawData), 0, 32) }
    }
  } finally { $sha.Dispose() }
  $outputStream.Write($plain, 0, $plain.Length)
} finally {
  foreach ($certificate in $certificates) { $certificate.Dispose() }
  [Array]::Clear($plain, 0, $plain.Length)
}
`;
export function decryptRemoteTlsKey(ciphertext: Buffer, signal?: AbortSignal): Promise<{ certificateHashes: string[]; pfx: Buffer }> {
  const root = process.env.SystemRoot;
  if (!root || !/^[a-z]:[\\/]/i.test(root) || !ciphertext.length || ciphertext.length > 128 * 1024)
    throw Error('设备连接私钥不可用。');
  return new Promise((resolve, reject) => {
    const systemShell = path.join(root, 'System32/WindowsPowerShell/v1.0');
    const child = execFile(path.join(systemShell, 'powershell.exe'),
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', unprotect],
      { windowsHide: true, timeout: 10000, signal, encoding: 'buffer', maxBuffer: 128 * 1024,
        env: { SystemRoot: root, PSModulePath: path.join(systemShell, 'Modules') } },
      (error, stdout) => {
        const count = stdout.length >= 4 ? stdout.readUInt32LE(0) : 0;
        const end = 4 + count * 32;
        if (!error && count > 0 && end < stdout.length)
          resolve({ certificateHashes: Array.from({ length: count }, (_, i) =>
            stdout.toString('hex', 4 + i * 32, 4 + (i + 1) * 32)), pfx: stdout.subarray(end) });
        else { stdout.fill(0); reject(Error('设备连接私钥不可用。')); }
      });
    child.stdin?.on('error', () => { /* The exit callback reports a closed or failed helper. */ });
    child.stdin?.end(ciphertext);
  });
}

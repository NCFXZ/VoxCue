import workspace from '../../shared/scripts/workspace.mjs';
import { X509Certificate, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chmod, lstat, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// This keychain contains only our local code-signing key. Never query or modify
// the login keychain, Safe Storage entries, userData, or Sparkle Ed25519 keys.
// Both development and release builds reuse this one local code-signing identity.
const directory = path.join(workspace.platformRoot, '.tools/development-signing');
const keychain = path.join(directory, 'development.keychain-db');
const certificateFile = path.join(directory, 'certificate.pem');
const passwordFile = path.join(directory, 'keychain-password');
const recordFile = path.join(directory, 'identity.json');
const pinFile = path.join(workspace.platformRoot, 'local-signing-public.json');
const commonName = 'VoxCue Local Development';

function run(command, args, secrets = [], options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options });
  if (result.error || result.status) {
    let message = result.error?.message ?? result.stderr ?? '';
    for (const secret of secrets) message = message.replaceAll(secret, '[redacted]');
    // Do not include argv: security's password arguments must never reach logs.
    throw Error(`${path.basename(command)} failed: ${message.trim()}`);
  }
  return result.stdout;
}

async function privatePath(file, isDirectory = false) {
  const stat = await lstat(file);
  if (
    stat.isSymbolicLink() ||
    (isDirectory ? !stat.isDirectory() : !stat.isFile()) ||
    stat.uid !== process.getuid() ||
    stat.mode & 0o077
  )
    throw Error(`Development signing material must be owned by this user and private: ${file}`);
}

async function certificateRecord() {
  if (process.platform !== 'darwin') throw Error('macOS required for local development signing.');
  try {
    await privatePath(directory, true);
    for (const file of [certificateFile, recordFile]) await privatePath(file);
    const record = JSON.parse(await readFile(recordFile, 'utf8'));
    const certificate = new X509Certificate(await readFile(certificateFile));
    const sha1 = certificate.fingerprint.replaceAll(':', '');
    const sha256 = certificate.fingerprint256.replaceAll(':', '');
    if (
      record.version !== 1 ||
      record.sha1 !== sha1 ||
      record.sha256 !== sha256 ||
      certificate.issuer !== certificate.subject ||
      !certificate.verify(certificate.publicKey) ||
      !certificate.keyUsage?.includes('1.3.6.1.5.5.7.3.3') ||
      Date.parse(certificate.validTo) <= Date.now() ||
      Date.parse(certificate.validFrom) > Date.now()
    )
      throw Error('The pinned local development certificate is invalid or has changed.');
    return { keychain, sha1, sha256 };
  } catch (error) {
    if (error.code === 'ENOENT')
      throw Error(
        'Fixed local signing identity is missing. Run node macos/scripts/setup-development-signing.mjs once; restore existing material rather than replacing an established identity.',
      );
    throw error;
  }
}

export async function localSigningCertificate() {
  const signing = await certificateRecord();
  const pin = JSON.parse(await readFile(pinFile, 'utf8'));
  if (pin.version !== 1 || pin.sha1 !== signing.sha1 || pin.sha256 !== signing.sha256)
    throw Error(
      'Local signing certificate does not match the public source pin. Restore the established identity; do not rotate it.',
    );
  return signing;
}

async function initializePublicPin(signing) {
  try {
    await writeFile(
      pinFile,
      JSON.stringify(
        {
          version: 1,
          sha1: signing.sha1,
          sha256: signing.sha256,
        },
        null,
        2,
      ) + '\n',
      { flag: 'wx' },
    );
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
}

export async function loadDevelopmentSigning() {
  const signing = await localSigningCertificate();
  for (const file of [keychain, passwordFile]) await privatePath(file);
  const password = await readFile(passwordFile, 'utf8');
  if (!/^[a-f0-9]{64}$/.test(password)) throw Error('Invalid development keychain password file.');
  run('/usr/bin/security', ['unlock-keychain', '-p', password, keychain], [password]);
  const identities = run('/usr/bin/security', ['find-identity', '-p', 'codesigning', keychain]);
  if (!identities.includes(signing.sha1))
    throw Error('The pinned development private key is missing.');
  return signing;
}

export async function initializeDevelopmentSigning() {
  if (process.platform !== 'darwin') throw Error('macOS required for local development signing.');
  const existing = await lstat(directory).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
  });
  // An incomplete/existing setup must never silently rotate the identity.
  if (existing) {
    await initializePublicPin(await certificateRecord());
    return loadDevelopmentSigning();
  }
  if (
    await lstat(pinFile).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
    })
  )
    throw Error(
      'This project already pins a signing identity. Restore its private signing directory from your secure backup instead of generating a replacement.',
    );
  await mkdir(path.dirname(directory), { recursive: true });
  await mkdir(directory, { mode: 0o700 });
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'voxcue-signing-setup-'));
  await chmod(temporary, 0o700);
  const cleanup = () => rm(temporary, { recursive: true, force: true });
  const interrupted = () => {
    void cleanup().finally(() => process.exit(1));
  };
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, interrupted);
  const password = randomBytes(32).toString('hex');
  try {
    const configuration = path.join(temporary, 'certificate.cnf');
    const privateKey = path.join(temporary, 'private.pem');
    const certificate = path.join(temporary, 'certificate.pem');
    const archive = path.join(temporary, 'identity.p12');
    await writeFile(
      configuration,
      `[req]
prompt = no
distinguished_name = name
x509_extensions = extensions
[name]
CN = ${commonName}
[extensions]
basicConstraints = critical,CA:FALSE
keyUsage = critical,digitalSignature
extendedKeyUsage = critical,codeSigning
subjectKeyIdentifier = hash
`,
      { mode: 0o600 },
    );
    run('/usr/bin/openssl', [
      'req',
      '-new',
      '-newkey',
      'rsa:3072',
      '-nodes',
      '-x509',
      '-sha256',
      '-days',
      '3650',
      '-config',
      configuration,
      '-keyout',
      privateKey,
      '-out',
      certificate,
    ]);
    await chmod(privateKey, 0o600);
    run(
      '/usr/bin/openssl',
      [
        'pkcs12',
        '-export',
        '-inkey',
        privateKey,
        '-in',
        certificate,
        '-name',
        commonName,
        '-out',
        archive,
        '-passout',
        'stdin',
      ],
      [password],
      { input: password + '\n' },
    );
    run('/usr/bin/security', ['create-keychain', '-p', password, keychain], [password]);
    await chmod(keychain, 0o600);
    run(
      '/usr/bin/security',
      [
        'import',
        archive,
        '-k',
        keychain,
        '-f',
        'pkcs12',
        '-P',
        password,
        '-x',
        '-T',
        '/usr/bin/codesign',
      ],
      [password],
    );
    // Restrict private-key use to Apple's signing tools in this dedicated keychain.
    run(
      '/usr/bin/security',
      [
        'set-key-partition-list',
        '-S',
        'apple-tool:',
        '-s',
        '-t',
        'private',
        '-k',
        password,
        keychain,
      ],
      [password],
    );
    const pem = await readFile(certificate);
    const parsed = new X509Certificate(pem);
    await writeFile(certificateFile, pem, { mode: 0o600, flag: 'wx' });
    await writeFile(passwordFile, password, { mode: 0o600, flag: 'wx' });
    await writeFile(
      recordFile,
      JSON.stringify({
        version: 1,
        sha1: parsed.fingerprint.replaceAll(':', ''),
        sha256: parsed.fingerprint256.replaceAll(':', ''),
      }) + '\n',
      { mode: 0o600, flag: 'wx' },
    );
    await initializePublicPin(await certificateRecord());
    return await loadDevelopmentSigning();
  } finally {
    // No exported private key or PKCS#12 remains after success or failure.
    // Retain partial persistent material on failure rather than silently rotate it.
    for (const signal of ['SIGINT', 'SIGTERM']) process.removeListener(signal, interrupted);
    await cleanup();
  }
}

export function developmentRequirement(signing, identifier) {
  if (!/^[A-F0-9]{40}$/.test(signing.sha1) || !/^[a-zA-Z0-9.-]+$/.test(identifier))
    throw Error('Invalid development signing requirement.');
  return `designated => identifier "${identifier}" and certificate root = H"${signing.sha1.toLowerCase()}"`;
}

export function verifyLocalApp(app, signing, identifier, { strict = true } = {}) {
  // The explicit pinned rule verifies our self-signed identity without adding it
  // to system trust. FinderInfo is tolerated only for existing workspace hosts;
  // fresh builds and distributable copies always receive strict verification.
  run('/usr/bin/codesign', [
    '--verify',
    '--deep',
    ...(strict ? ['--strict'] : []),
    '-R',
    '=' + developmentRequirement(signing, identifier).replace('designated => ', ''),
    app,
  ]);
}

export function signLocalCode(file, signing, identifier, { preserveMetadata = true } = {}) {
  // Replace the vendor/ad-hoc requirement. Preserving it would retain its changing
  // cdhash (or Apple's vendor identity) and defeat continuity across our builds.
  run('/usr/bin/codesign', [
    '--force',
    '--sign',
    signing.sha1,
    '--keychain',
    signing.keychain,
    '--timestamp=none',
    ...(preserveMetadata ? ['--preserve-metadata=entitlements,flags,runtime'] : ['--options', '0']),
    ...(identifier ? ['--requirements', '=' + developmentRequirement(signing, identifier)] : []),
    file,
  ]);
}

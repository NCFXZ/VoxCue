import {
  mkdtemp,
  mkdir,
  readdir,
  cp,
  rm,
  readFile,
  writeFile,
  lstat,
  open,
} from 'node:fs/promises';
import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import workspace from '../../shared/scripts/workspace.mjs';
import { loadDevelopmentSigning, signLocalCode, verifyLocalApp } from './development-signing.mjs';

function verifyDeployment(file) {
  const commands = execFileSync('otool', ['-l', file], { encoding: 'utf8' });
  const match =
    commands.match(/\bminos (\d+)\.(\d+)/) ??
    commands.match(/LC_VERSION_MIN_MACOSX\s+cmdsize \d+\s+version (\d+)\.(\d+)/);
  if (!match || Number(match[1]) > 14 || (Number(match[1]) === 14 && Number(match[2]) > 2))
    throw Error('Qwen runtime requires a newer macOS than 14.2: ' + path.basename(file));
}

// Build tools/source are supplied by the developer; nothing is installed globally.
// The application ships this signed runtime, while models retain their original archives.
export async function buildQwen({
  source,
  cargo = 'cargo',
  cmake = 'cmake',
  python = process.env.VOXCUE_PYTHON,
  env = {},
  updateLock = false,
} = {}) {
  if (process.platform !== 'darwin' || process.arch !== 'arm64')
    throw Error('Apple Silicon required');
  const signing = await loadDevelopmentSigning();
  const native = path.join(workspace.platformRoot, 'native/bin/qwen');
  const digest = createHash('sha256');
  async function hashSources(directory) {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory() && !['target', '.git'].includes(entry.name)) await hashSources(file);
      else if (entry.isFile()) {
        digest.update(file);
        digest.update(await readFile(file));
      }
    }
  }
  await hashSources(path.join(workspace.sharedRoot, 'native/qwen-speech'));
  for (const file of [
    'native/qwen-mlx.rs',
    'native/qwen-mlx.py',
    'native/qwen-mlx.lock.json',
    'scripts/assemble-qwen-mlx.py',
  ])
    digest.update(await readFile(path.join(workspace.platformRoot, file)));
  digest.update(await readFile(new URL(import.meta.url)));
  digest.update(signing.sha256);
  const revision = digest.digest('hex');
  try {
    const marker = JSON.parse(await readFile(path.join(native, 'build.json'), 'utf8'));
    if (marker.revision === revision) {
      const actualFiles = [];
      async function inventory(directory) {
        for (const entry of await readdir(directory, { withFileTypes: true })) {
          const file = path.join(directory, entry.name);
          if (entry.isDirectory()) await inventory(file);
          else if (entry.isFile()) actualFiles.push(path.relative(native, file));
          else throw Error('Runtime contains a link or non-regular file');
        }
      }
      await inventory(native);
      if (
        actualFiles.some(
          (file) =>
            file !== 'build.json' &&
            !Object.hasOwn(marker.files, file) &&
            !Object.hasOwn(marker.files, file.replace(/ \d+(?=\.|$)/g, '')),
        )
      )
        throw Error('Runtime file set changed');
      for (const [file, hash] of Object.entries(marker.files))
        if (
          path.isAbsolute(file) ||
          file.split(/[\\/]/).includes('..') ||
          createHash('sha256')
            .update(await readFile(path.join(native, file)))
            .digest('hex') !== hash
        )
          throw Error('Runtime changed');
      verifyLocalApp(path.join(native, 'voxcue-qwen'), signing, 'com.voxcue.qwen');
      for (const file of marker.codeFiles ?? []) verifyDeployment(path.join(native, file));
      if (!marker.codeFiles?.includes('python/bin/python3.12')) throw Error('MLX runtime missing');
      return;
    }
  } catch {
    /* Missing or stale builds require the explicit pinned toolchain. */
  }
  if (!source)
    throw Error(
      'VOXCUE_SPEECH_CPP must point to speech.cpp a72f1bbedd50e293d5b3f4c2bf0fb44ec003227d with ggml a655cf6910770404213bc338e622cd82b08ca277',
    );
  if (!python)
    throw Error(
      'VOXCUE_PYTHON must point to a developer Python 3.12+ to assemble the pinned MLX runtime',
    );
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'voxcue-qwen-build-'));
  const children = new Set();
  const interrupted = async (signal) => {
    for (const child of children) {
      try {
        process.kill(-child.pid, 'SIGTERM');
      } catch {
        child.kill();
      }
    }
    await Promise.all(
      [...children].map((child) => new Promise((resolve) => child.once('close', resolve))),
    );
    await rm(temporary, { recursive: true, force: true });
    process.exit(signal === 'SIGINT' ? 130 : 143);
  };
  const onInterrupt = () => {
    void interrupted('SIGINT');
  };
  const onTerminate = () => {
    void interrupted('SIGTERM');
  };
  process.once('SIGINT', onInterrupt);
  process.once('SIGTERM', onTerminate);
  async function run(file, args, extra = {}) {
    const child = spawn(file, args, {
      stdio: 'inherit',
      detached: true,
      // Developer CMake may itself be a Python console script. Keep its
      // interpreter from writing bytecode into a reused private runtime.
      env: { ...process.env, ...env, PYTHONDONTWRITEBYTECODE: '1', ...extra },
    });
    children.add(child);
    child.once('close', () => children.delete(child));
    const code = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', resolve);
    });
    if (code !== 0) throw Error(file + ' failed: ' + code);
  }
  try {
    const vad = env.VOXCUE_QWEN_VAD_BUILD ?? path.join(temporary, 'vad');
    await run(cmake, [
      '-S',
      source,
      '-B',
      vad,
      '-DCMAKE_BUILD_TYPE=Release',
      '-DCMAKE_OSX_DEPLOYMENT_TARGET=14.2',
      '-DBUILD_SHARED_LIBS=ON',
      '-DGGML_METAL=OFF',
      '-DGGML_CUDA=OFF',
      '-DGGML_VULKAN=OFF',
      '-DGGML_OPENMP=OFF',
      '-DGGML_NATIVE=OFF',
      '-DSPEECH_BUILD_EXAMPLES=OFF',
      '-DSPEECH_BUILD_TESTS=OFF',
    ]);
    await run(cmake, ['--build', vad, '--config', 'Release', '--target', 'speech', '-j', '4']);
    const libraries = [];
    async function collect(directory) {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const file = path.join(directory, entry.name);
        if (entry.isDirectory()) await collect(file);
        else if ((entry.isFile() || entry.isSymbolicLink()) && entry.name.endsWith('.dylib'))
          libraries.push(file);
      }
    }
    await collect(vad);
    const speech = libraries.find((file) => path.basename(file).startsWith('libspeech.'));
    if (!speech) throw Error('CPU VAD library missing');
    const manifest = path.join(workspace.sharedRoot, 'native/qwen-speech/Cargo.toml');
    const target = env.CARGO_TARGET_DIR ?? path.join(temporary, 'target');
    await run(
      cargo,
      [
        'build',
        '--release',
        ...(updateLock ? [] : ['--locked']),
        '--no-default-features',
        '--features',
        'metal',
        '--manifest-path',
        manifest,
      ],
      {
        VOXCUE_VAD_LIB: path.dirname(speech),
        CARGO_TARGET_DIR: target,
        RUSTFLAGS: '-C link-arg=-Wl,-rpath,@loader_path',
        CARGO_BUILD_JOBS: '4',
        // Rust's stripped host proc-macros can have an invalid LINKEDIT pool
        // with the macOS 27 linker. Host tools never enter the application.
        CARGO_PROFILE_RELEASE_BUILD_OVERRIDE_DEBUG: '2',
        CARGO_PROFILE_RELEASE_BUILD_OVERRIDE_STRIP: 'none',
        MACOSX_DEPLOYMENT_TARGET: '14.2',
      },
    );
    const staging = path.join(temporary, 'runtime');
    await mkdir(staging);
    await cp(path.join(target, 'release/voxcue-qwen'), path.join(staging, 'voxcue-qwen'));
    for (const file of libraries)
      await cp(file, path.join(staging, path.basename(file)), { dereference: true });
    await run(python, [
      '-I',
      '-B',
      path.join(workspace.platformRoot, 'scripts/assemble-qwen-mlx.py'),
      staging,
      env.VOXCUE_QWEN_MLX_BUILD ?? path.join(temporary, 'mlx-cache'),
    ]);
    // Never ship absolute temporary loader paths.
    const names = [];
    async function codeInventory(directory) {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const file = path.join(directory, entry.name);
        if (entry.isDirectory()) await codeInventory(file);
        else if (entry.isFile()) {
          const handle = await open(file, 'r');
          try {
            const magic = Buffer.alloc(4);
            await handle.read(magic, 0, 4, 0);
            if (
              [
                'feedface',
                'feedfacf',
                'cefaedfe',
                'cffaedfe',
                'cafebabe',
                'bebafeca',
                'cafebabf',
                'bfbafeca',
              ].includes(magic.toString('hex'))
            )
              names.push(path.relative(staging, file));
          } finally {
            await handle.close();
          }
        } else throw Error('Redirected runtime file');
      }
    }
    await codeInventory(staging);
    for (const name of names) {
      const file = path.join(staging, name);
      if (name.endsWith('.dylib') && !name.includes(path.sep))
        await run('install_name_tool', ['-id', '@rpath/' + name, file]);
      for (const library of libraries)
        await run('install_name_tool', [
          '-change',
          library,
          '@rpath/' + path.basename(library),
          file,
        ]);
      const commands = execFileSync('otool', ['-l', file], { encoding: 'utf8' });
      for (const match of commands.matchAll(/cmd LC_RPATH\s+cmdsize \d+\s+path (.+) \(offset/g)) {
        if (path.isAbsolute(match[1]))
          await run('install_name_tool', ['-delete_rpath', match[1], file]);
      }
      signLocalCode(file, signing, name === 'voxcue-qwen' ? 'com.voxcue.qwen' : undefined, {
        preserveMetadata: false,
      });
      verifyDeployment(file);
    }
    // Same fixed Silero bytes as the Windows runtime; never replace the VAD.
    const response = await fetch(
      'https://huggingface.co/sakasegawa/silero-vad-GGUF/resolve/main/silero-vad-309K-v6.2-F32.gguf',
      { signal: AbortSignal.timeout(60000) },
    );
    if (!response.ok) throw Error('Silero download failed');
    const vadBytes = Buffer.from(await response.arrayBuffer());
    if (
      vadBytes.length !== 1238624 ||
      createHash('sha256').update(vadBytes).digest('hex') !==
        '2fc312514e5fc4fa4ffd02b25c76a4853fa4130e8fb9777d01502183b01238cb'
    )
      throw Error('Silero checksum mismatch');
    await writeFile(path.join(staging, 'silero-vad.gguf'), vadBytes);
    await cp(path.join(source, 'LICENSE'), path.join(staging, 'LICENSE-speech.cpp'));
    await cp(path.join(source, 'ggml/LICENSE'), path.join(staging, 'LICENSE-ggml'));
    await cp(
      path.join(workspace.sharedRoot, 'native/qwen-speech/README.md'),
      path.join(staging, 'README-VoxCue.md'),
    );
    const sileroLicense = await fetch(
      'https://raw.githubusercontent.com/snakers4/silero-vad/master/LICENSE',
      { signal: AbortSignal.timeout(30000) },
    );
    if (!sileroLicense.ok) throw Error('Silero license download failed');
    const licenseBytes = Buffer.from(await sileroLicense.arrayBuffer());
    if (
      createHash('sha256').update(licenseBytes).digest('hex') !==
      '2e63e9a38b6e8fc0c7bc37ce174caca1862870856c6daf5697cfb785e925520b'
    )
      throw Error('Silero license checksum mismatch');
    await writeFile(path.join(staging, 'LICENSE-silero'), licenseBytes);
    const metadata = JSON.parse(
      execFileSync(
        cargo,
        [
          'metadata',
          '--locked',
          '--format-version',
          '1',
          '--filter-platform',
          'aarch64-apple-darwin',
          '--no-default-features',
          '--features',
          'metal',
          '--manifest-path',
          manifest,
        ],
        { env: { ...process.env, ...env }, maxBuffer: 32 * 1024 * 1024 },
      ),
    );
    const licenses = path.join(staging, 'licenses');
    await mkdir(licenses);
    for (const pkg of metadata.packages) {
      const directory = path.dirname(pkg.manifest_path);
      const destination = path.join(licenses, pkg.name + '-' + pkg.version);
      await mkdir(destination, { recursive: true });
      for (const name of await readdir(directory)) {
        if (
          /^(license|copying|notice)/i.test(name) ||
          (['qwen-forced-aligner-rs', 'nagisa_rs'].includes(pkg.name) && name === 'README.md')
        )
          await cp(path.join(directory, name), path.join(destination, name), {
            recursive: true,
            dereference: true,
          });
      }
      await writeFile(
        path.join(destination, 'SOURCE.json'),
        JSON.stringify({
          name: pkg.name,
          version: pkg.version,
          source: pkg.source,
          license: pkg.license,
        }),
      );
    }
    await writeFile(
      path.join(staging, 'SOURCES.txt'),
      'speech.cpp a72f1bbedd50e293d5b3f4c2bf0fb44ec003227d\nggml a655cf6910770404213bc338e622cd82b08ca277\nQwen Rust origins: shared/native/qwen-speech/README.md\n',
    );
    const files = {};
    async function hashRuntime(directory) {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const file = path.join(directory, entry.name);
        if (entry.isDirectory()) await hashRuntime(file);
        else
          files[path.relative(staging, file)] = createHash('sha256')
            .update(await readFile(file))
            .digest('hex');
      }
    }
    await hashRuntime(staging);
    await mkdir(native, { recursive: true });
    const codeFiles = names.map((file) => path.join(native, file));
    const occupied = spawnSync('/usr/sbin/lsof', ['-t', '--', ...codeFiles], {
      encoding: 'utf8',
      timeout: 10000,
    });
    if (occupied.error || occupied.stdout.trim())
      throw Error('Close Qwen before rebuilding its runtime');
    // fs.cp replaces existing files and makes File Provider resurrect numbered
    // copies. Write managed file contents through their existing identities.
    for (const name of Object.keys(files)) {
      const destination = path.join(native, name);
      let parent = native;
      for (const part of path
        .dirname(name)
        .split(path.sep)
        .filter((part) => part !== '.')) {
        parent = path.join(parent, part);
        await mkdir(parent, { recursive: true });
        const info = await lstat(parent);
        if (!info.isDirectory() || info.isSymbolicLink())
          throw Error('Redirected runtime directory');
      }
      const sourceFile = path.join(staging, name);
      const handle = await open(
        destination,
        constants.O_CREAT | constants.O_WRONLY | constants.O_TRUNC | constants.O_NOFOLLOW,
        (await lstat(sourceFile)).mode & 0o777,
      );
      try {
        await handle.writeFile(await readFile(sourceFile));
      } finally {
        await handle.close();
      }
    }
    await writeFile(
      path.join(native, 'build.json'),
      JSON.stringify({ revision, files, codeFiles: names }),
    );
    console.log(
      'Built signed arm64 Qwen MLX Metal/Rust CPU runtime; asynchronous original CPU alignment.',
    );
  } finally {
    process.removeListener('SIGINT', onInterrupt);
    process.removeListener('SIGTERM', onTerminate);
    await rm(temporary, { recursive: true, force: true });
  }
}
if (process.argv[1] === new URL(import.meta.url).pathname) {
  await buildQwen({
    source: process.env.VOXCUE_SPEECH_CPP,
    cargo: process.env.VOXCUE_CARGO,
    cmake: process.env.VOXCUE_CMAKE,
  });
}

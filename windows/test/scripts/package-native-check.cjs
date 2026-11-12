// Guest-only native checks against the installed production ASAR. The caller
// supplies the same-version official Electron host; no product test flag is used.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const physicalFs = require('original-fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createRequire } = require('node:module');
const { spawn } = require('node:child_process');
const { Worker } = require('node:worker_threads');
const { app, utilityProcess } = require('electron');

let phase = 'checking-guest';
let resultFile;
let nonce;
const report = {};
function failureDetails(error) {
  const details = {
    errorType: [
      'Error',
      'AssertionError',
      'TypeError',
      'RangeError',
      'SyntaxError',
      'AbortError',
      'TimeoutError',
      'KnowledgeError',
    ].includes(error?.name)
      ? error.name
      : 'Error',
    errorReason: 'unclassified',
  };
  const message = typeof error?.message === 'string' ? error.message : '';
  const codes = [
    'ENOENT',
    'EACCES',
    'EPERM',
    'EINVAL',
    'ENOTDIR',
    'EPIPE',
    'ECONNRESET',
    'ETIMEDOUT',
    'ERR_DLOPEN_FAILED',
    'MODULE_NOT_FOUND',
    'ERR_MODULE_NOT_FOUND',
    'ERR_REQUIRE_ESM',
    'ERR_REQUIRE_ASYNC_MODULE',
    'unavailable',
    'invalid_request',
    'configuration',
    'integrity',
    'not_ready',
    'cancelled',
    'closed',
  ];
  const code = codes.find(
    (value) => error?.code === value || new RegExp('\\b' + value + '\\b').test(message),
  );
  if (code) details.errorCode = code;
  for (const [pattern, value] of [
    [/Copilot CLI not found at /, 'runtime-not-found'],
    [/Failed to start CLI server:/, 'runtime-spawn-failed'],
    [/CLI server exited (?:unexpectedly )?with code /, 'runtime-exited'],
    [/CLI server connection failed:/, 'runtime-connection-failed'],
    [/Timeout waiting for CLI server to start|Native fixture deadline/, 'runtime-timeout'],
    [
      /Failed to load native binding|The specified module could not be found|ERR_DLOPEN_FAILED/i,
      'native-binding-load',
    ],
    [/Cannot find module|MODULE_NOT_FOUND/, 'module-not-found'],
    [/EACCES|Access is denied|operation not permitted/i, 'access-denied'],
    [/protocol.*(?:mismatch|unsupported)|(?:mismatch|unsupported).*protocol/i, 'protocol-mismatch'],
    [
      /Connection (?:got )?disposed|Connection is closed|Channel closed|write EPIPE/i,
      'transport-closed',
    ],
  ])
    if (pattern.test(message)) {
      details.errorReason = value;
      break;
    }
  if (details.errorReason === 'unclassified' && code)
    details.errorReason = code.toLowerCase().replaceAll('_', '-');
  const exit = message.match(/CLI server exited (?:unexpectedly )?with code (-?\d+)/)?.[1];
  if (
    exit !== undefined &&
    Number.isSafeInteger(Number(exit)) &&
    Math.abs(Number(exit)) <= 0xffffffff
  )
    details.runtimeExitCode = Number(exit);
  const stack = typeof error?.stack === 'string' ? error.stack : '';
  const line = Number(stack.match(/package-native-check\.cjs:(\d+):\d+/)?.[1]);
  if (Number.isSafeInteger(line) && line > 0 && line <= 100000) details.sourceLine = line;
  return details;
}
const within = (root, target) => {
  const relative = path.relative(root, target);
  return !!relative && !relative.startsWith('..') && !path.isAbsolute(relative);
};
function ordinary(target, directory = false) {
  // Electron's node:fs presents app.asar as a virtual directory.
  const info = physicalFs.lstatSync(target);
  assert.equal(info.isSymbolicLink(), false);
  assert.equal(directory ? info.isDirectory() : info.isFile(), true);
  assert.equal(physicalFs.realpathSync(target).toLowerCase(), path.resolve(target).toLowerCase());
}
function noRedirectedAncestors(target) {
  let current = path.resolve(target);
  for (;;) {
    ordinary(current, true);
    const parent = path.dirname(current);
    if (parent === current) return;
    current = parent;
  }
}
async function deadline(work, milliseconds) {
  let timer;
  try {
    return await Promise.race([
      work,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(Error('Native fixture deadline')), milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
function messageUntil(source, predicate, send, milliseconds) {
  let cleanup = () => {};
  return deadline(
    new Promise((resolve, reject) => {
      cleanup = () => {
        source.off('message', message);
        source.off('error', failed);
        source.off('exit', exited);
      };
      const failed = () => {
        cleanup();
        reject(Error('Native fixture child failed'));
      };
      const exited = () => {
        cleanup();
        reject(Error('Native fixture child exited'));
      };
      const message = (value) => {
        if (value.error) return failed();
        if (!predicate(value)) return;
        cleanup();
        resolve(value);
      };
      source.on('message', message);
      source.once('error', failed);
      source.once('exit', exited);
      send();
    }),
    milliseconds,
  ).finally(() => cleanup());
}
async function checkSdk(load, unpacked, work) {
  phase = 'copilot-sdk-load';
  const env = { ...process.env };
  for (const key of Object.keys(env))
    if (/^(?:COPILOT_|GITHUB_|GH_|CODEX_|OPENAI_|AZURE_OPENAI_|OTEL_)/i.test(key)) delete env[key];
  Object.assign(env, {
    GH_CONFIG_DIR: path.join(work, 'gh-unused'),
    XDG_CONFIG_HOME: work,
    XDG_CACHE_HOME: work,
    XDG_STATE_HOME: work,
    HTTP_PROXY: 'http://127.0.0.1:1',
    HTTPS_PROXY: 'http://127.0.0.1:1',
    ALL_PROXY: 'http://127.0.0.1:1',
    NO_PROXY: '',
  });
  const { CopilotClient } = load('@github/copilot-sdk');
  const { copilotRuntimeConnection } = load(
    './dist-electron/shared/electron/backend/copilot/runtime.js',
  );
  phase = 'copilot-selector';
  const connection = copilotRuntimeConnection();
  assert.equal(connection.kind, 'stdio');
  assert.ok(within(unpacked, path.resolve(connection.path)));
  ordinary(connection.path);
  const baseDirectory = path.join(work, 'copilot');
  await fsp.mkdir(baseDirectory);
  phase = 'copilot-client-create';
  const client = new CopilotClient({
    connection,
    mode: 'empty',
    baseDirectory,
    workingDirectory: work,
    env,
    useLoggedInUser: false,
    enableRemoteSessions: false,
    logLevel: 'none',
  });
  let failure;
  try {
    const started = performance.now();
    phase = 'copilot-client-start';
    await deadline(client.start(), 20000);
    phase = 'copilot-ping';
    assert.equal(
      (
        await deadline(
          client.ping('packaged-runtime'),
          Math.max(1, 20000 - (performance.now() - started)),
        )
      ).message,
      'pong: packaged-runtime',
    );
  } catch (error) {
    failure = { error, phase };
  }
  phase = 'copilot-stop';
  try {
    assert.equal((await client.stop()).length, 0);
  } catch (error) {
    failure ??= { error, phase };
  }
  if (failure) {
    phase = failure.phase;
    throw failure.error;
  }
  report.copilotRuntime = true;
  phase = 'codex-synthetic-token';
  const { CodexUsageRuntime, codexUsageExecutable } = load(
    './dist-electron/shared/electron/backend/chat/codexUsage.js',
  );
  assert.ok(within(unpacked, codexUsageExecutable()));
  const sockets = new Set();
  const proxy = require('node:net').createServer((socket) => {
    sockets.add(socket);
    socket.on('error', () => {});
    socket.once('close', () => sockets.delete(socket));
    socket.resume();
  });
  await new Promise((resolve, reject) => {
    proxy.once('error', reject);
    proxy.listen(0, '127.0.0.1', resolve);
  });
  const proxyUrl = 'http://127.0.0.1:' + proxy.address().port;
  const launch = (binary, args, options) =>
    spawn(
      binary,
      args.map((value) =>
        value === 'cli_auth_credentials_store="keyring"'
          ? 'cli_auth_credentials_store="file"'
          : value,
      ),
      {
        ...options,
        env: {
          ...options.env,
          ...env,
          HTTP_PROXY: proxyUrl,
          HTTPS_PROXY: proxyUrl,
          ALL_PROXY: proxyUrl,
        },
      },
    );
  const home = path.join(work, 'codex');
  const runtime = new CodexUsageRuntime(home, launch);
  try {
    assert.equal(await runtime.account(), null);
    await runtime.stop();
    const part = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const token =
      part({ alg: 'none' }) +
      '.' +
      part({
        sub: 'synthetic',
        email: 'synthetic@example.test',
        exp: Math.floor(Date.now() / 1000) + 3600,
        'https://api.openai.com/auth': {
          chatgpt_account_id: 'synthetic-workspace',
          chatgpt_plan_type: 'plus',
        },
      }) +
      '.synthetic';
    await fsp.writeFile(
      path.join(home, 'auth.json'),
      JSON.stringify({
        auth_mode: 'chatgpt',
        tokens: {
          id_token: token,
          access_token: token,
          refresh_token: 'synthetic-refresh',
          account_id: 'synthetic-workspace',
        },
        last_refresh: new Date().toISOString(),
      }),
    );
    assert.equal((await deadline(runtime.access(), 5000)).token, token);
    report.codexSyntheticToken = true;
  } finally {
    await runtime.stop();
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => proxy.close(resolve));
  }
}
async function checkSpeech(load, unpacked, appDirectory, fixtures) {
  phase = 'asr-worker';
  const speech = path.join(unpacked, 'dist-electron/shared/electron/backend/speech');
  const model = path.join(fixtures, 'speech');
  assert.deepEqual(
    fs.readdirSync(model).sort(),
    [
      'LICENSE-sherpa.txt',
      'LICENSE-silero.txt',
      'NOTICE.txt',
      'README.md',
      'decoder.int8.onnx',
      'encoder.int8.onnx',
      'manifest.json',
      'silero_vad.onnx',
      'tokens.txt',
    ].sort(),
  );
  const worker = new Worker(path.join(speech, 'worker.js'));
  let decoded = false;
  worker.on('message', (message) => {
    if (
      message.event?.type === 'segment' &&
      message.event.segment.final &&
      message.event.segment.text.trim()
    )
      decoded = true;
  });
  try {
    await messageUntil(
      worker,
      (m) => m.ready,
      () =>
        worker.postMessage({
          op: 'init',
          directory: model,
          preprocessorFile: path.join(
            unpacked,
            'dist-electron/windows/electron/speech/echoCancellation.js',
          ),
        }),
      45000,
    );
    await messageUntil(
      worker,
      (m) => m.prepared === 9,
      () =>
        worker.postMessage({
          op: 'prepare',
          id: 9,
          sources: ['system', 'microphone'],
        }),
      10000,
    );
    phase = 'asr-gap-reset';
    await messageUntil(
      worker,
      (m) => m.flushed === 7,
      () => {
        const audio = (source, count, rate, sequence, extra = {}) =>
          worker.postMessage({
            op: 'audio',
            source,
            samples: new Float32Array(count),
            rate,
            timestamp: Date.now(),
            sequence,
            ms: (count / rate) * 1000,
            ...extra,
          });
        audio('system', 1600, 16000, 1);
        worker.postMessage({ op: 'gap', source: 'system' });
        audio('system', 1600, 16000, 2);
        audio('microphone', 883, 44100, 3, { captureClock: 100 });
        audio('microphone', 883, 44100, 4);
        worker.postMessage({ op: 'flush', id: 7, reason: 'pause' });
      },
      15000,
    );
    report.asrGapReset = true;
    phase = 'asr-decode';
    const wave = load('sherpa-onnx-node').readWave(path.join(fixtures, 'english.wav'), false);
    await messageUntil(
      worker,
      (m) => m.flushed === 8,
      () => {
        for (let offset = 0; offset < wave.samples.length; offset += 512) {
          const samples = wave.samples.slice(offset, offset + 512);
          worker.postMessage({
            op: 'audio',
            source: 'system',
            samples,
            rate: wave.sampleRate,
            timestamp: Date.now(),
            sequence: offset + 10,
            ms: (samples.length / wave.sampleRate) * 1000,
          });
        }
        worker.postMessage({ op: 'flush', id: 8, reason: 'stop' });
      },
      15000,
    );
    assert.equal(decoded, true);
    report.asrWorker = true;
  } finally {
    await worker.terminate();
  }
  phase = 'speech-utility';
  const helper = path.join(appDirectory, 'resources/native/VoxCue.Audio.exe');
  ordinary(helper);
  const child = utilityProcess.fork(
    path.join(unpacked, 'dist-electron/windows/electron/speech/process.js'),
    [],
    {
      serviceName: 'VoxCue guest package verification',
      stdio: 'pipe',
    },
  );
  let exited = false;
  const retirement = new Promise((resolve) =>
    child.once('exit', (code) => {
      exited = true;
      resolve(code);
    }),
  );
  child.stdout?.on('data', () => {});
  child.stderr?.on('data', () => {});
  try {
    await messageUntil(
      child,
      (m) => m.id === 'init',
      () => child.postMessage({ id: 'init', init: true, model, helper }),
      15000,
    );
    const status = await messageUntil(
      child,
      (m) => m.id === 'status',
      () => child.postMessage({ id: 'status', call: { op: 'status' } }),
      15000,
    );
    assert.equal(status.value.state, 'idle');
    await messageUntil(
      child,
      (m) => m.id === 'close',
      () => child.postMessage({ id: 'close', close: true }),
      15000,
    );
    report.speechUtility = true;
  } finally {
    if (!exited) child.kill();
    await deadline(retirement, 10000);
  }
}
async function checkKnowledge(load, fixtures, work) {
  phase = 'knowledge-host-load';
  report.msvcRuntime = Object.fromEntries(
    ['vcruntime140', 'vcruntime140_1', 'msvcp140', 'msvcp140_1', 'msvcp140_atomic_wait'].map(
      (name) => [
        name,
        physicalFs.existsSync(path.join(process.env.WINDIR, 'System32', name + '.dll')),
      ],
    ),
  );
  const { KnowledgeHost } = load('./dist-electron/shared/electron/backend/knowledge/host.js');
  const directory = path.join(work, 'knowledge');
  const model = path.join(fixtures, 'rag');
  let host = new KnowledgeHost(directory, model);
  const signal = () => new AbortController().signal;
  const encoded = [
    {
      documentId: 'legacy-doc',
      name: 'legacy.doc',
      file: 'legacy.doc',
      query: 'pkglegacydocmarker',
      expected: ['生产 Worker 保留中文', '尾部参数 43'],
    },
    {
      documentId: 'gb18030-text',
      name: 'encoded.txt',
      file: 'encoded-gb18030.txt',
      query: '机械臂',
      expected: ['传感器反馈控制机械臂', '这个系统支持中文和英文资料'],
    },
    {
      documentId: 'utf16-markdown',
      name: 'encoded.md',
      file: 'encoded-utf16.md',
      query: 'pkgutf16marker',
      expected: ['pkgutf16marker', '尾部参数为 52'],
    },
  ];
  const checkEncoded = async () => {
    for (const input of encoded) {
      phase = 'knowledge-query-' + input.documentId;
      const hits = await host.search(input.query, 5, 'keyword', signal(), 'packaged');
      const hit = hits.find((item) => item.documentId === input.documentId);
      assert.ok(hit);
      const item = await host.getItem(hit.itemId);
      assert.equal(item?.documentId, input.documentId);
      for (const expected of input.expected) assert.ok(item.content.includes(expected));
    }
  };
  try {
    phase = 'knowledge-initialize';
    const starting = host.initialize();
    host.child?.stderr.on('data', (chunk) => {
      const reason = failureDetails(Error(chunk.toString())).errorReason;
      if (reason !== 'unclassified') report.knowledgeDiagnostic = reason;
    });
    host.child?.once('exit', (code) => {
      if (Number.isSafeInteger(code)) report.knowledgeExitCode = code;
    });
    await starting;
    phase = 'knowledge-index-sensor';
    await host.indexDocument(
      {
        documentId: 'sensor',
        baseId: 'packaged',
        name: 'sensor.md',
        bytes: Buffer.from(
          '## Q001. PID sensor lift-off control?\n\n' +
            'PID feedback sensor control. '.repeat(120) +
            ' tailxyz is 37.\n\n### 追问 1：如何限幅？\n\n输出限制为 2。',
        ),
      },
      signal(),
    );
    for (const input of [
      { documentId: 'pdf', name: 'fixture.pdf', file: 'fixture.pdf' },
      { documentId: 'docx', name: 'fixture.docx', file: 'fixture.docx' },
      ...encoded,
    ]) {
      phase = 'knowledge-index-' + input.documentId;
      await host.indexDocument(
        {
          documentId: input.documentId,
          baseId: 'packaged',
          name: input.name,
          bytes: new Uint8Array(await fsp.readFile(path.join(fixtures, input.file))),
        },
        signal(),
      );
    }
    await checkEncoded();
    phase = 'knowledge-query-pdf';
    const pdfHits = await host.search('gain', 5, 'keyword', signal(), 'packaged');
    assert.equal(pdfHits[0].page, 2);
    phase = 'knowledge-query-docx';
    const docxHits = await host.search('Second paragraph', 5, 'keyword', signal(), 'packaged');
    const docx = docxHits.find((item) => item.documentId === 'docx');
    assert.ok(docx);
    const docxContent = await host.getItem(docx.itemId);
    assert.ok(docxContent?.content.includes('中文 DOCX sensor feedback'));
    assert.ok(docxContent.content.includes('Second paragraph is retained'));
    report.knowledgeFormats = true;
    phase = 'knowledge-modes';
    for (const mode of ['keyword', 'vector', 'hybrid']) {
      const hits = await host.search('PID sensor 提离 control', 5, mode, signal());
      const item = await host.getItem(hits[0].itemId);
      assert.ok(item?.content.includes('tailxyz'));
      assert.ok(item.content.includes('限制为 2'));
    }
    report.knowledgeModes = true;
    phase = 'knowledge-restart';
    await host.close();
    host = new KnowledgeHost(directory, model);
    assert.deepEqual(
      (await host.listDocuments()).map((item) => item.documentId).sort(),
      ['sensor', 'pdf', 'docx', ...encoded.map((item) => item.documentId)].sort(),
    );
    await checkEncoded();
    report.knowledgeRestart = true;
    phase = 'knowledge-delete';
    await host.removeDocument('sensor', signal());
    assert.equal((await host.search('tailxyz', 5, 'keyword', signal())).length, 0);
    report.knowledgeDelete = true;
  } finally {
    await host.close();
  }
}
async function checkMobile(load, archive) {
  phase = 'mobile-assets';
  const { createMobileAssets } = load(
    './dist-electron/shared/electron/backend/remoteConnection/assets.js',
  );
  const assets = createMobileAssets(path.join(archive, 'dist'));
  const entry = await assets.read('/');
  assert.ok(entry?.body.length);
  const references = [...entry.body.toString('utf8').matchAll(/(?:src|href)="([^"]+)"/g)].map(
    (match) => match[1],
  );
  assert.ok(references.length >= 2);
  for (const reference of references) {
    const name = reference.replace(/^\.\//, '');
    assert.match(name, /^assets\//);
    assert.ok((await assets.read('/' + name))?.body.length);
  }
  for (const privatePath of [
    '/index.html',
    '/package.json',
    '/../resources/app.asar',
    '/assets/../index.html',
  ])
    assert.equal(await assets.read(privatePath), null);
  report.mobileAssets = true;
}
async function main() {
  assert.equal(process.platform, 'win32');
  assert.equal(process.arch, 'x64');
  assert.equal(os.userInfo().username.toLowerCase(), 'wdagutilityaccount');
  const profile = path.resolve(os.homedir());
  assert.equal(profile.toLowerCase(), 'c:\\users\\wdagutilityaccount');
  noRedirectedAncestors(profile);
  assert.equal(process.argv.length, 5);
  const [configFile, outputFile, workArgument] = process.argv
    .slice(2)
    .map((file) => path.resolve(file));
  const inputConfigFile = 'C:\\VoxCueStoreInput\\config.json';
  ordinary(inputConfigFile);
  assert.ok(fs.statSync(inputConfigFile).size <= 16384);
  const inputConfig = JSON.parse(fs.readFileSync(inputConfigFile, 'utf8'));
  assert.match(inputConfig.nonce, /^[a-f0-9-]{36}$/i);
  assert.match(inputConfig.version, /^\d+\.\d+\.\d+$/);
  nonce = inputConfig.nonce;
  const workRoot = path.resolve(os.tmpdir(), 'voxcue-store-' + nonce);
  assert.ok(
    workArgument.toLowerCase() === workRoot.toLowerCase() || within(workRoot, workArgument),
  );
  noRedirectedAncestors(workArgument);
  assert.ok(within(workArgument, configFile));
  noRedirectedAncestors(path.dirname(configFile));
  ordinary(configFile);
  assert.ok(fs.statSync(configFile).size <= 16384);
  const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
  assert.equal(config.nonce, nonce);
  assert.equal(config.version, inputConfig.version);
  assert.equal(
    outputFile.toLowerCase(),
    path.resolve('C:\\VoxCueStoreOutput', 'package-native-' + nonce + '.json').toLowerCase(),
  );
  assert.equal(fs.existsSync(outputFile), false);
  noRedirectedAncestors(path.dirname(outputFile));
  resultFile = outputFile;
  phase = 'checking-work';
  const work = path.join(workArgument, 'package-native');
  assert.equal(fs.existsSync(work), false);
  fs.mkdirSync(work);
  phase = 'checking-fixtures';
  const fixtures = path.resolve(config.fixtureDirectory);
  assert.equal(fixtures.toLowerCase(), 'c:\\voxcuestoreinput\\fixtures');
  noRedirectedAncestors(fixtures);
  phase = 'checking-installed-package';
  const appDirectory = path.resolve(config.appDirectory);
  const archive = path.join(appDirectory, 'resources/app.asar');
  ordinary(archive);
  const unpacked = archive + '.unpacked';
  ordinary(unpacked, true);
  phase = 'checking-package-version';
  const load = createRequire(archive + '/package.json');
  assert.equal(load('./package.json').version, config.version);
  app.setAppPath(archive);
  const userData = path.join(work, 'profile');
  fs.mkdirSync(userData);
  app.setPath('userData', userData);
  app.setPath('sessionData', userData);
  await app.whenReady();
  report.finalAsar = true;
  await checkSdk(load, unpacked, work);
  await checkSpeech(load, unpacked, appDirectory, fixtures);
  await checkKnowledge(load, fixtures, work);
  await checkMobile(load, archive);
  phase = 'screenshot-worker';
  const { encodeScreenshotBitmap } = load(
    './dist-electron/shared/electron/backend/screenshot/host.js',
  );
  const bitmap = new ArrayBuffer(16 * 16 * 4);
  new Uint8Array(bitmap).fill(255);
  const image = await encodeScreenshotBitmap(
    { width: 16, height: 16, bitmap },
    new AbortController().signal,
  );
  assert.equal(image.file.name, 'screenshot.png');
  assert.equal(Buffer.from(image.file.bytes).subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.match(image.preview, /^data:image\/jpeg;base64,/);
  report.screenshotWorker = true;
  phase = 'complete';
}
async function writeResult(value) {
  const partial = resultFile + '.tmp';
  await fsp.writeFile(partial, JSON.stringify(value), { flag: 'wx' });
  await fsp.rename(partial, resultFile);
}
main().then(
  async () => {
    await writeResult({ nonce, ok: true, phase, ...report });
    app.exit(0);
  },
  async (error) => {
    if (resultFile)
      await writeResult({
        nonce,
        ok: false,
        phase,
        ...(report.knowledgeDiagnostic ? { knowledgeDiagnostic: report.knowledgeDiagnostic } : {}),
        ...(report.knowledgeExitCode !== undefined
          ? { knowledgeExitCode: report.knowledgeExitCode }
          : {}),
        ...(report.msvcRuntime ? { msvcRuntime: report.msvcRuntime } : {}),
        ...failureDetails(error),
      });
    app.exit(1);
  },
);

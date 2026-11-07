import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import { execFileSync, spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Certificates and package installation exist only in the disposable guest.
// https://learn.microsoft.com/windows/security/application-security/application-isolation/windows-sandbox/windows-sandbox-configure-using-wsb-file
// https://learn.microsoft.com/powershell/module/appx/invoke-commandindesktoppackage
assert.equal(process.platform, 'win32');
assert.equal(process.argv.length, 2, 'This check accepts only the current Store release');
const platformRoot = fileURLToPath(new URL('../../', import.meta.url));
const repositoryRoot = path.resolve(platformRoot, '..');
const { version } = JSON.parse(
  await readFile(path.join(repositoryRoot, 'shared/package.json'), 'utf8'),
);
assert.match(version, /^\d+\.\d+\.\d+$/);
const [major, minor, patch] = version.split('.').map(Number);
const packageVersion = `${major + 1}.${minor}.${patch}.0`;
const artifact = path.join(platformRoot, 'release/store', `VoxCue-Store-${version}-x64.appx`);
const sandboxExe = path.join(process.env.WINDIR, 'System32/WindowsSandbox.exe');
const powershell = path.join(process.env.WINDIR, 'System32/WindowsPowerShell/v1.0/powershell.exe');
const nonce = randomUUID();
const temporary = await realpath(os.tmpdir());
// A still-mapped Sandbox must never enter the generic test-run recovery sweep.
const temporaryPrefix = 'voxcue-store-sandbox-';
const ownerMarker = '.voxcue-store-sandbox-owner.json';
const root = await mkdtemp(path.join(temporary, temporaryPrefix));
const input = path.join(root, 'input');
const output = path.join(root, 'output');
const configuration = path.join(root, 'store.wsb');
const control = path.join(output, 'stop');
const resultFile = path.join(output, 'result.json');
const statusFile = path.join(output, 'status.json');
const owned = new Map();
const interrupted = new AbortController();
const interrupt = () => interrupted.abort(Error('Store Sandbox verification interrupted'));
process.once('SIGINT', interrupt);
process.once('SIGTERM', interrupt);
let child;
let childError;
let startedAt = 0;
let originalHash;
let failure;
let lastStage;

const psLiteral = (value) => "'" + String(value).replaceAll("'", "''") + "'";
function ps(script, timeout = 30000) {
  const encoded = Buffer.from("$ErrorActionPreference='Stop';\n" + script, 'utf16le').toString(
    'base64',
  );
  return execFileSync(powershell, ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
    encoding: 'utf8',
    windowsHide: true,
    timeout,
    maxBuffer: 1024 * 1024,
  })
    .trim()
    .replace(/^\uFEFF/, '');
}
const sandboxProcesses = () =>
  JSON.parse(
    ps(`
  $items = @(Get-CimInstance Win32_Process -Filter "Name LIKE 'WindowsSandbox%.exe'" | ForEach-Object {
    @{ pid=[int]$_.ProcessId; parent=[int]$_.ParentProcessId; command=$_.CommandLine;
       created=$_.CreationDate.ToUniversalTime().ToString('o'); path=$_.ExecutablePath }
  });
  ConvertTo-Json -InputObject $items -Compress
`),
  );
function adopt(rows) {
  let added;
  do {
    added = false;
    for (const row of rows) {
      if (owned.has(row.pid)) {
        const known = owned.get(row.pid);
        if (known) assert.equal(row.created, known, 'Sandbox PID was reused');
        else owned.set(row.pid, row.created);
      } else if (
        Date.parse(row.created) >= startedAt - 1000 &&
        (owned.has(row.parent) || row.command?.toLowerCase().includes(configuration.toLowerCase()))
      ) {
        owned.set(row.pid, row.created);
        added = true;
      }
    }
  } while (added);
  const unknown = rows.filter((row) => !owned.has(row.pid));
  assert.equal(
    unknown.length,
    0,
    'An active Sandbox has unknown ownership; it will not be stopped',
  );
}
async function ordinary(file) {
  const info = await lstat(file);
  assert.ok(info.isFile() && !info.isSymbolicLink(), 'Expected a regular file: ' + file);
  assert.equal(path.relative(file, await realpath(file)), '', 'Redirected input: ' + file);
}
async function hash(file) {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(file)) digest.update(chunk);
  return digest.digest('hex');
}
async function readResult(file) {
  const info = await lstat(file).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
  });
  if (!info) return;
  assert.ok(info.isFile() && !info.isSymbolicLink() && info.size <= 65536, 'Unsafe guest result');
  const data = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(data.nonce, nonce, 'Unexpected guest result owner');
  return data;
}
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// A Node inspector client reads the actual installed Electron process. No
// production module, process.windowsStore flag, IPC handler or result is mocked.
const inspectorClient = String.raw`
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const [configFile, work, outputFile] = process.argv.slice(2);
const config = JSON.parse(await fs.readFile(configFile, 'utf8'));
let socket;
let sequence = 0;
const pending = new Map();
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const deadline = Date.now() + 120000;
try {
  let target;
  while (!target) {
    if (Date.now() > deadline) throw Error('Installed Store main-process inspector did not start');
    try {
      const response = await fetch('http://127.0.0.1:9229/json/list', {signal:AbortSignal.timeout(1000)});
      if (response.ok) target = (await response.json()).find(item => item.webSocketDebuggerUrl);
    } catch {}
    if (!target) await delay(250);
  }
  assert.ok(target.webSocketDebuggerUrl.startsWith('ws://127.0.0.1:9229/'));
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve,reject) => {
    const timer = setTimeout(() => reject(Error('Inspector websocket timeout')),10000);
    socket.addEventListener('open',() => {clearTimeout(timer);resolve();},{once:true});
    socket.addEventListener('error',() => {clearTimeout(timer);reject(Error('Inspector websocket failed'));},{once:true});
  });
  socket.addEventListener('message',message => {
    const value = JSON.parse(message.data);
    if (!value.id) return;
    const request = pending.get(value.id);
    if (!request) return;
    pending.delete(value.id);clearTimeout(request.timer);
    if (value.error) request.reject(Error(JSON.stringify(value.error)));
    else request.resolve(value.result);
  });
  const send = (method,params={}) => new Promise((resolve,reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => {pending.delete(id);reject(Error('Inspector command timeout: '+method));},30000);
    pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}));
  });
  const evaluate = async expression => {
    const value = await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});
    if (value.exceptionDetails) throw Error(value.exceptionDetails.exception?.description ?? value.exceptionDetails.text);
    return value.result.value;
  };
  await send('Runtime.enable');
  await send('Runtime.runIfWaitingForDebugger');
  const prelude = "const req=process.getBuiltinModule('module').createRequire(process.resourcesPath+'/app.asar/package.json');const electron=req('electron');";
  let runtime;
  while (!runtime) {
    if (Date.now() > deadline) throw Error('Installed Store application did not become ready');
    const state = await evaluate('(async()=>{'+prelude+'return electron.app.isReady()?{pid:process.pid,windowsStore:process.windowsStore,packaged:electron.app.isPackaged,version:electron.app.getVersion(),userData:electron.app.getPath(\'userData\')}:null})()');
    if (state) runtime = state;else await delay(250);
  }
  assert.equal(runtime.windowsStore,true,'Actual packaged process.windowsStore must be true');
  assert.equal(runtime.packaged,true);
  assert.equal(runtime.version,config.version);
  assert.equal(runtime.userData.toLowerCase(),(work+'\\profile').toLowerCase(),'Only the temporary guest profile may be used');
  let login;
  while (!login) {
    if (Date.now() > deadline) throw Error('Installed Store login renderer did not load');
    login = await evaluate('(async()=>{'+prelude+'const win=electron.BrowserWindow.getAllWindows().find(win=>win.webContents.getURL().endsWith(\'#login\'));return win?await win.webContents.executeJavaScript(\'typeof window.desktop?.setLocalMode === "function"\'):false})()');
    if (!login) await delay(250);
  }
  // This is the shipped local-account entry, in a fresh guest, through its real
  // renderer/preload/IPC authorization. No synthetic authentication helper runs.
  const entered = await evaluate('(async()=>{'+prelude+'const win=electron.BrowserWindow.getAllWindows().find(win=>win.webContents.getURL().endsWith(\'#login\'));return win.webContents.executeJavaScript(\'window.desktop.setLocalMode(true)\')})()');
  assert.equal(entered.ok,true);
  assert.equal(entered.state.localMode,true);
  let update;
  while (!update) {
    if (Date.now() > deadline) throw Error('Installed Store main renderer did not load');
    update = await evaluate('(async()=>{'+prelude+'const win=electron.BrowserWindow.getAllWindows().find(win=>win.webContents.getURL().startsWith(\'file:\')&&!win.webContents.getURL().endsWith(\'#login\'));if(!win)return null;return win.webContents.executeJavaScript(\'typeof window.desktop?.updates === "function" ? window.desktop.updates({op:"status"}) : null\')})()');
    if (!update) await delay(250);
  }
  assert.equal(update.phase,'unavailable');
  assert.equal(update.currentVersion,config.version);
  assert.equal(update.message,config.storeUpdateMessage);
  const states = await evaluate('(async()=>{'+prelude+'const win=electron.BrowserWindow.getAllWindows().find(win=>win.webContents.getURL().startsWith(\'file:\')&&!win.webContents.getURL().endsWith(\'#login\'));return win.webContents.executeJavaScript(\'Promise.all([{op:"check",force:true},{op:"download"},{op:"install"}].map(call=>window.desktop.updates(call)))\')})()');
  assert.equal(states.length,3);
  for(const state of states){assert.equal(state.phase,'unavailable');assert.equal(state.currentVersion,config.version);assert.equal(state.message,config.storeUpdateMessage);}
  const driverDisabled = await evaluate('(async()=>{'+prelude+'const driver=req(electron.app.getAppPath()+\'/dist-electron/shared/electron/backend/updates/driver.js\');return driver.createUpdateDriver(electron.app.isPackaged)===undefined&&driver.updateUnavailableReason(electron.app.isPackaged)==='+JSON.stringify(config.storeUpdateMessage)+'})()');
  assert.equal(driverDisabled,true);
  await fs.writeFile(outputFile,JSON.stringify({nonce:config.nonce,...runtime,driverDisabled,updatePhases:[update,...states].map(state=>state.phase)}));
  await evaluate('(()=>{'+prelude+'setTimeout(()=>electron.app.quit(),50);return true})()');
} finally {
  for(const request of pending.values()){clearTimeout(request.timer);request.reject(Error('Inspector client closed'));}
  socket?.close();
}
`;

const guestScript = String.raw`
$ErrorActionPreference = 'Stop'
$config = Get-Content -LiteralPath 'C:\VoxCueStoreInput\config.json' -Raw | ConvertFrom-Json
$output = 'C:\VoxCueStoreOutput'
$work = Join-Path $env:TEMP ('voxcue-store-' + $config.nonce)
$result = @{ nonce=$config.nonce; ok=$false; stage='starting' }
function Write-OwnedJson($name, $value) {
  $target = Join-Path $output $name
  $partial = $target + '.' + [Guid]::NewGuid().ToString('N') + '.tmp'
  [IO.File]::WriteAllText($partial, ($value | ConvertTo-Json -Depth 10 -Compress), (New-Object Text.UTF8Encoding $false))
  Move-Item -LiteralPath $partial -Destination $target -Force
}
function Stage($name) {
  $result.stage = $name
  Write-OwnedJson 'status.json' @{nonce=$config.nonce; stage=$name}
  if (Test-Path -LiteralPath (Join-Path $output 'stop')) { throw 'Host requested Sandbox shutdown' }
}
try {
  New-Item -ItemType Directory -Path $work | Out-Null
  # An independent guest watchdog also shuts down if install or inspection hangs.
  $watch = '$end=(Get-Date).AddMinutes(12); while((Get-Date)-lt $end){if(Test-Path -LiteralPath "C:\VoxCueStoreOutput\stop"){break};Start-Sleep -Seconds 1};& "$env:WINDIR\System32\shutdown.exe" /s /t 0 /f'
  $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($watch))
  Start-Process -FilePath (Join-Path $PSHOME 'powershell.exe') -ArgumentList @('-NoProfile','-NonInteractive','-EncodedCommand',$encoded) -WindowStyle Hidden | Out-Null
  Stage 'copying-package'
  $source = Join-Path 'C:\VoxCueStoreInput' $config.artifactName
  if ((Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant() -ne $config.sha256) { throw 'Mapped APPX checksum mismatch' }
  $candidate = Join-Path $work 'candidate.appx'
  Copy-Item -LiteralPath $source -Destination $candidate
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $zip = [IO.Compression.ZipFile]::OpenRead($candidate)
  try {
    $entry = $zip.GetEntry('AppxManifest.xml')
    if (-not $entry) { throw 'APPX manifest missing' }
    $reader = New-Object IO.StreamReader($entry.Open())
    try { [xml]$manifest = $reader.ReadToEnd() } finally { $reader.Dispose() }
  } finally { $zip.Dispose() }
  $identity = $manifest.Package.Identity
  if ($identity.Name -ne $config.identityName -or $identity.Publisher -ne $config.publisher -or $identity.Version -ne $config.packageVersion) { throw 'Unexpected APPX identity or version' }
  $applications = @($manifest.Package.Applications.Application)
  if ($applications.Count -ne 1 -or $applications[0].Id -notmatch '^[A-Za-z0-9.]+$') { throw 'Unexpected APPX application' }
  if (Get-AppxPackage -Name $config.identityName) { throw 'Sandbox is not a clean package environment' }
  Stage 'signing-guest-copy'
  $cert = New-SelfSignedCertificate -Type Custom -KeyUsage DigitalSignature -KeyAlgorithm RSA -KeyLength 2048 -HashAlgorithm SHA256 -CertStoreLocation 'Cert:\CurrentUser\My' -TextExtension @('2.5.29.37={text}1.3.6.1.5.5.7.3.3','2.5.29.19={text}') -Subject $config.publisher -FriendlyName ('VoxCue Sandbox ' + $config.nonce) -NotAfter (Get-Date).AddDays(1)
  $cer = Join-Path $work 'guest-test.cer'
  Export-Certificate -Cert $cert -FilePath $cer | Out-Null
  Import-Certificate -FilePath $cer -CertStoreLocation 'Cert:\LocalMachine\Root' | Out-Null
  Import-Certificate -FilePath $cer -CertStoreLocation 'Cert:\LocalMachine\TrustedPeople' | Out-Null
  & 'C:\VoxCueStoreInput\tools\signtool.exe' sign /fd SHA256 /sha1 $cert.Thumbprint /s My $candidate | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Signing temporary guest APPX failed' }
  & 'C:\VoxCueStoreInput\tools\signtool.exe' verify /pa $candidate | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Guest APPX signature verification failed' }
  Stage 'installing-appx'
  Add-AppxPackage -Path $candidate -ErrorAction Stop
  $package = Get-AppxPackage -Name $config.identityName
  if (-not $package -or $package.Version.ToString() -ne $config.packageVersion -or $package.Publisher -ne $config.publisher) { throw 'Installed APPX identity/version mismatch' }
  $exe = [IO.Path]::GetFullPath((Join-Path $package.InstallLocation $applications[0].Executable))
  if (-not $exe.StartsWith($package.InstallLocation + '\', [StringComparison]::OrdinalIgnoreCase) -or [IO.Path]::GetFileName($exe) -ne 'VoxCue.exe') { throw 'Unexpected installed executable' }
  Stage 'launching-package-identity'
  Get-Command Invoke-CommandInDesktopPackage -ErrorAction Stop | Out-Null
  $env:COPILOT_TEST_USER_DATA = Join-Path $work 'profile'
  $env:VOXCUE_ACCOUNT_API = ''
  $env:VITE_DEV_SERVER_URL = ''
  Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
  Invoke-CommandInDesktopPackage -PackageFamilyName $package.PackageFamilyName -AppId $applications[0].Id -Command $exe -Args '--inspect-brk=127.0.0.1:9229' -PreventBreakaway
  Stage 'checking-real-store-runtime'
  $runtimeFile = Join-Path $work 'runtime.json'
  & 'C:\VoxCueStoreInput\tools\node.exe' 'C:\VoxCueStoreInput\inspect.mjs' 'C:\VoxCueStoreInput\config.json' $work $runtimeFile 2> (Join-Path $work 'inspect-error.txt')
  if ($LASTEXITCODE -ne 0) { throw ('Installed runtime verification failed: ' + (Get-Content -LiteralPath (Join-Path $work 'inspect-error.txt') -Raw)) }
  $runtime = Get-Content -LiteralPath $runtimeFile -Raw | ConvertFrom-Json
  if ($runtime.nonce -ne $config.nonce -or -not $runtime.windowsStore -or -not $runtime.driverDisabled -or $runtime.version -ne $config.version) { throw 'Invalid installed Store runtime result' }
  if ((Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant() -ne $config.sha256) { throw 'Read-only source APPX changed' }
  $result.ok = $true
  $result.stage = 'complete'
  $result.packageVersion = $package.Version.ToString()
  $result.packageFamilyName = $package.PackageFamilyName
  $result.appVersion = $runtime.version
  $result.windowsStore = $runtime.windowsStore
  $result.packaged = $runtime.packaged
  $result.driverDisabled = $runtime.driverDisabled
  $result.updatePhases = $runtime.updatePhases
  $result.sourceUnchanged = $true
} catch {
  $result.error = $_.Exception.Message
} finally {
  Write-OwnedJson 'result.json' $result
  & "$env:WINDIR\System32\shutdown.exe" /s /t 0 /f
}
`;

try {
  await mkdir(input);
  await mkdir(output);
  await writeFile(
    path.join(root, ownerMarker),
    JSON.stringify({ kind: temporaryPrefix, pid: process.pid, nonce }),
  );
  await ordinary(artifact);
  await ordinary(sandboxExe);
  const feature = JSON.parse(
    ps(
      `$feature = Get-CimInstance Win32_OptionalFeature -Filter "Name='Containers-DisposableClientVM'"
       [pscustomobject]@{present=$null -ne $feature; installState=$feature.InstallState} | ConvertTo-Json -Compress`,
    ),
  );
  assert.equal(feature.present, true, 'Windows Sandbox optional feature is unavailable');
  assert.equal(feature.installState, 1, 'Windows Sandbox must already be enabled');
  assert.deepEqual(sandboxProcesses(), [], 'Close existing or unknown Sandbox sessions first');
  const framework = path.join(process.env.WINDIR, 'Microsoft.NET/Framework64/v4.0.30319');
  const probe = path.join(root, 'WindowProbe.exe');
  execFileSync(
    path.join(framework, 'csc.exe'),
    [
      '/nologo',
      '/platform:x64',
      '/target:exe',
      '/r:System.Drawing.dll',
      '/r:System.Web.Extensions.dll',
      ...['UIAutomationClient', 'UIAutomationTypes', 'WindowsBase'].map(
        (name) => '/r:' + path.join(framework, 'WPF', name + '.dll'),
      ),
      '/out:' + probe,
      path.join(platformRoot, 'test/fixtures/WindowProbe.cs'),
    ],
    { windowsHide: true, timeout: 30000, stdio: 'pipe' },
  );
  const requireDesktop = () =>
    assert.equal(
      JSON.parse(
        execFileSync(probe, ['desktop'], { encoding: 'utf8', windowsHide: true, timeout: 15000 }),
      ).interactive,
      true,
      'Store Sandbox check requires the owner unlocked console',
    );
  requireDesktop();
  const tools = path.join(input, 'tools');
  await mkdir(tools);
  const node = path.join(platformRoot, '.tools/node-v24.19.0-win-x64/node.exe');
  const kitRoot = path.join(platformRoot, '.cache/electron-builder/win-codesign@1.1.0');
  const kits = (await readdir(kitRoot, { withFileTypes: true })).filter(
    (entry) => entry.isDirectory() && /^windows-kits-bundle-10_0_26100_0-/.test(entry.name),
  );
  assert.equal(kits.length, 1, 'Expected the existing fixed Windows SDK tool bundle');
  const kit = path.join(kitRoot, kits[0].name, 'x64');
  const signTool = path.join(kit, 'signtool.exe');
  for (const [file, publisher] of [
    [node, 'OpenJS Foundation'],
    [signTool, 'Microsoft Corporation'],
  ]) {
    await ordinary(file);
    const signature = JSON.parse(
      ps(
        `Get-AuthenticodeSignature -LiteralPath ${psLiteral(file)} | Select-Object @{Name='status';Expression={$_.Status.ToString()}},@{Name='publisher';Expression={$_.SignerCertificate.Subject}} | ConvertTo-Json -Compress`,
      ),
    );
    assert.equal(
      signature.status,
      'Valid',
      'Verification tools must have valid official signatures',
    );
    assert.ok(signature.publisher.includes(publisher), 'Unexpected verification tool publisher');
  }
  await copyFile(node, path.join(tools, 'node.exe'));
  // SignTool uses its matching SDK DLLs and side-by-side manifests.
  for (const entry of await readdir(kit, { withFileTypes: true })) {
    if (
      entry.isFile() &&
      (entry.name === 'signtool.exe' ||
        entry.name.endsWith('.dll') ||
        entry.name.endsWith('.manifest'))
    ) {
      const source = path.join(kit, entry.name);
      await ordinary(source);
      await copyFile(source, path.join(tools, entry.name));
    }
  }
  originalHash = await hash(artifact);
  await copyFile(artifact, path.join(input, path.basename(artifact)));
  assert.equal(await hash(path.join(input, path.basename(artifact))), originalHash);
  await writeFile(
    path.join(input, 'config.json'),
    JSON.stringify({
      nonce,
      version,
      packageVersion,
      artifactName: path.basename(artifact),
      sha256: originalHash,
      identityName: 'NCFX.VoxCue',
      publisher: 'CN=CC9C4962-FFC8-44D9-A2C0-B446CBFD375A',
      storeUpdateMessage: '此版本由 Microsoft Store 提供更新。',
    }),
  );
  await writeFile(path.join(input, 'guest.ps1'), '\uFEFF' + guestScript);
  await writeFile(path.join(input, 'inspect.mjs'), inspectorClient);
  const xml = (value) =>
    String(value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;');
  await writeFile(
    configuration,
    `<Configuration>
    <vGPU>Disable</vGPU><Networking>Disable</Networking><AudioInput>Disable</AudioInput><VideoInput>Disable</VideoInput><ClipboardRedirection>Disable</ClipboardRedirection><PrinterRedirection>Disable</PrinterRedirection><ProtectedClient>Enable</ProtectedClient><MemoryInMB>4096</MemoryInMB>
    <MappedFolders><MappedFolder><HostFolder>${xml(input)}</HostFolder><SandboxFolder>C:\\VoxCueStoreInput</SandboxFolder><ReadOnly>true</ReadOnly></MappedFolder><MappedFolder><HostFolder>${xml(output)}</HostFolder><SandboxFolder>C:\\VoxCueStoreOutput</SandboxFolder><ReadOnly>false</ReadOnly></MappedFolder></MappedFolders>
    <LogonCommand><Command>powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File C:\\VoxCueStoreInput\\guest.ps1</Command></LogonCommand>
  </Configuration>`,
  );
  assert.deepEqual(
    sandboxProcesses(),
    [],
    'A Sandbox started during preparation; refusing to reuse it',
  );
  requireDesktop();
  startedAt = Date.now();
  child = spawn(sandboxExe, [configuration], { stdio: 'ignore', windowsHide: true });
  child.once('error', (error) => {
    childError = error;
  });
  assert.ok(child.pid, 'Sandbox process did not start');
  owned.set(child.pid, null);
  console.log('Store Sandbox: starting isolated guest');
  const deadline = Date.now() + 10 * 60 * 1000;
  while (true) {
    interrupted.signal.throwIfAborted();
    requireDesktop();
    if (childError) throw childError;
    adopt(sandboxProcesses());
    const status = await readResult(statusFile);
    if (status && status.stage !== lastStage) {
      console.log('Store Sandbox: ' + (lastStage = status.stage));
    }
    const result = await readResult(resultFile);
    if (result) {
      assert.equal(result.ok, true, JSON.stringify(result));
      assert.equal(result.packageVersion, packageVersion);
      assert.equal(result.appVersion, version);
      assert.equal(result.windowsStore, true);
      assert.equal(result.driverDisabled, true);
      assert.equal(result.sourceUnchanged, true);
      assert.deepEqual(result.updatePhases, [
        'unavailable',
        'unavailable',
        'unavailable',
        'unavailable',
      ]);
      console.log(JSON.stringify(result));
      break;
    }
    if (Date.now() > deadline)
      throw Error('Store Sandbox verification timed out at ' + (lastStage ?? 'guest startup'));
    await delay(1000);
  }
} catch (error) {
  failure = error;
} finally {
  try {
    await writeFile(control, nonce).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
    });
    if (child) {
      let rows = [];
      const deadline = Date.now() + 30000;
      do {
        rows = sandboxProcesses();
        adopt(rows);
        if (!rows.length) break;
        await delay(1000);
      } while (Date.now() < deadline);
      for (const row of rows) {
        assert.equal(
          owned.get(row.pid),
          row.created,
          'Refusing to stop an unowned Sandbox process',
        );
        const current = sandboxProcesses().find((item) => item.pid === row.pid);
        if (current) {
          assert.equal(current.created, row.created, 'Sandbox PID was reused');
          execFileSync('taskkill.exe', ['/PID', String(row.pid), '/T', '/F'], {
            windowsHide: true,
            stdio: 'pipe',
            timeout: 10000,
          });
        }
      }
      assert.deepEqual(
        sandboxProcesses(),
        [],
        'Sandbox did not shut down; temporary mapping retained',
      );
    }
    if (originalHash)
      assert.equal(await hash(artifact), originalHash, 'Original Store APPX changed');
    assert.equal(path.dirname(await realpath(root)), temporary);
    assert.ok(path.basename(root).startsWith(temporaryPrefix));
    const owner = JSON.parse(await readFile(path.join(root, ownerMarker), 'utf8'));
    assert.equal(owner.kind, temporaryPrefix);
    assert.equal(owner.pid, process.pid);
    assert.equal(owner.nonce, nonce);
    async function noLinks(directory) {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        assert.ok(!entry.isSymbolicLink(), 'Refusing redirected temporary path');
        if (entry.isDirectory()) await noLinks(path.join(directory, entry.name));
      }
    }
    await noLinks(root);
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch (cleanup) {
    failure = failure
      ? new AggregateError(
          [failure, cleanup],
          'Store Sandbox failed; cleanup incomplete at ' + root,
        )
      : cleanup;
  }
  process.removeListener('SIGINT', interrupt);
  process.removeListener('SIGTERM', interrupt);
}
if (failure) throw failure;
console.log(
  'PASS Store Sandbox: installed identity/version, real Store runtime and disabled standalone updates; guest stopped, original unchanged, temporary files cleaned',
);

import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
  copyFile,
  cp,
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
import { createRequire } from 'node:module';

// Acceptance of unmodified production packages, not an owner UI fixture.
// Official SDKs may start against the fresh guest's empty vault. The VM has no
// network or host profile/credential mapping; no real service login is used.
// Certificates and package installation exist only in the disposable guest.
// https://learn.microsoft.com/windows/security/application-security/application-isolation/windows-sandbox/windows-sandbox-configure-using-wsb-file
// https://learn.microsoft.com/windows/security/application-security/application-isolation/windows-sandbox/windows-sandbox-cli
// https://learn.microsoft.com/powershell/module/appx/invoke-commandindesktoppackage
assert.equal(process.platform, 'win32');
const argument = process.argv[2];
const copilotVault = argument === '--copilot-vault';
const nsisTask =
  argument === '--nsis-current' ? 'nsis-current'
    : ['--nsis-upgrade', '--nsis-upgrade-1.1.1'].includes(argument) ? 'nsis-upgrade'
    : undefined;
const appxArgument = argument?.startsWith('--appx=') ? argument : undefined;
assert.ok(
  process.argv.length === 2 ||
    (process.argv.length === 3 &&
      (copilotVault ||
        nsisTask ||
        (appxArgument?.startsWith('--appx=') && appxArgument.length > '--appx='.length))),
  'Use the current Store release, --appx=<owned temporary current APPX>, --copilot-vault, --nsis-current, --nsis-upgrade or --nsis-upgrade-1.1.1',
);
const platformRoot = fileURLToPath(new URL('../../', import.meta.url));
const repositoryRoot = path.resolve(platformRoot, '..');
const { version } = JSON.parse(
  await readFile(path.join(repositoryRoot, 'shared/package.json'), 'utf8'),
);
assert.match(version, /^\d+\.\d+\.\d+$/);
const [major, minor, patch] = version.split('.').map(Number);
const packageVersion = `${major + 1}.${minor}.${patch}.0`;
const artifact = copilotVault
  ? undefined
  : nsisTask
    ? path.join(platformRoot, 'release/installer', `VoxCue-Setup-${version}-x64.exe`)
    : appxArgument
      ? path.resolve(appxArgument.slice('--appx='.length))
      : path.join(platformRoot, 'release/store', `VoxCue-Store-${version}-x64.appx`);
// Compare immutable released bytes against the independent Windows release records.
const previousVersions = {
  '--nsis-upgrade': ['1.2.0', 'a83d1399fb2dae98cc4dfcf98924c6e571d6c17a461ca92a8292556bbcc610ae'],
  '--nsis-upgrade-1.1.1': ['1.1.1', 'cb84c1f7b22f5e613a1401dc38e201817d78dac0b214721b8fbb7d6f09998bfd'],
};
const [previousVersion, previousDigest] =
  nsisTask === 'nsis-upgrade' ? previousVersions[argument] : [];
const previousArtifact = previousVersion
  ? path.join(platformRoot, 'release', previousVersion, `VoxCue-Setup-${previousVersion}-x64.exe`)
  : undefined;
const label = copilotVault ? 'Copilot vault Sandbox' : nsisTask ? 'NSIS Sandbox' : 'Store Sandbox';
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
let previousHash;
let hostSid;
let failure;
let lastStage;
let sandboxCli;
let ownVmId;
let ownRemote;

const psLiteral = (value) => "'" + String(value).replaceAll("'", "''") + "'";
function ps(script, timeout = 30000) {
  // WinPS 5 must not auto-load incompatible PowerShell 7 modules inherited
  // from the caller. This changes only this child process's module lookup.
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.toLowerCase() === 'psmodulepath') delete env[key];
  env.PSModulePath = path.join(path.dirname(powershell), 'Modules');
  const encoded = Buffer.from(
    "$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; [Console]::OutputEncoding=New-Object Text.UTF8Encoding $false;\n" +
      script,
    'utf16le',
  ).toString('base64');
  return execFileSync(powershell, ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
    encoding: 'utf8',
    env,
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
    @{ pid=[int]$_.ProcessId; parent=[int]$_.ParentProcessId; name=$_.Name;
       created=$_.CreationDate.ToUniversalTime().ToString('o'); path=$_.ExecutablePath }
  });
  ConvertTo-Json -InputObject $items -Compress
`),
  );
const isServer = (row) => row.name.toLowerCase() === 'windowssandboxserver.exe';
const isRemote = (row) => row.name.toLowerCase() === 'windowssandboxremotesession.exe';
const remoteIdentity = (row) => ({
  pid: row.pid,
  parent: row.parent,
  created: row.created,
  path: row.path,
});
function sandboxIds() {
  const output = ps(
    `& ${psLiteral(sandboxCli)} list; if ($LASTEXITCODE -ne 0) { throw 'Windows Sandbox list failed' }`,
  );
  // The current official CLI emits one ID per line, or no text for no VMs.
  // Diagnostics, table headers or malformed/duplicate IDs must never mean empty.
  const ids = output ? output.split(/\r?\n/) : [];
  for (const id of ids)
    assert.match(
      id,
      /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i,
      'Unexpected Sandbox list output',
    );
  const normalized = ids.map((id) => id.toLowerCase());
  assert.equal(new Set(normalized).size, normalized.length, 'Duplicate Sandbox VM IDs');
  return normalized;
}
function adopt(rows, allowUnknown = false) {
  let added;
  do {
    added = false;
    for (const row of rows) {
      // list itself may create this long-lived daemon without creating a VM.
      // It is never an owned viewer, never a shutdown target, and may remain.
      if (isServer(row)) continue;
      if (owned.has(row.pid)) {
        const known = owned.get(row.pid);
        if (known) assert.equal(row.created, known, 'Sandbox PID was reused');
        else owned.set(row.pid, row.created);
      } else if (Date.parse(row.created) >= startedAt - 1000 && owned.has(row.parent)) {
        owned.set(row.pid, row.created);
        added = true;
      }
    }
  } while (added);
  if (!allowUnknown)
    assert.equal(
      rows.filter((row) => !isServer(row) && !owned.has(row.pid)).length,
      0,
      'An active Sandbox has unknown ownership; it will not be stopped',
    );
}
function observeSandbox() {
  const ids = sandboxIds();
  const rows = sandboxProcesses();
  adopt(rows);
  assert.ok(ids.length <= 1, 'An unrelated Sandbox VM started during this check');
  const remotes = rows.filter((row) => isRemote(row) && owned.has(row.pid));
  assert.ok(remotes.length <= 1, 'Ambiguous owned Sandbox viewer');
  if (ownVmId) {
    if (ids.length) assert.equal(ids[0], ownVmId, 'Sandbox VM identity changed');
    if (remotes.length)
      assert.deepEqual(remoteIdentity(remotes[0]), ownRemote, 'Sandbox viewer identity changed');
  } else if (ids.length === 1 && remotes.length === 1) {
    // Both preflights had zero VMs and zero viewers. Only the unique new ID
    // together with the spawned launcher's verified process chain proves ours.
    assert.ok(path.isAbsolute(remotes[0].path), 'Sandbox viewer path is unavailable');
    assert.equal(path.basename(remotes[0].path).toLowerCase(), 'windowssandboxremotesession.exe');
    ownVmId = ids[0];
    ownRemote = remoteIdentity(remotes[0]);
  }
}
async function stopOwnedSandbox() {
  // Never kill the daemon or an arbitrary process tree. Stop only the VM
  // bound to our unique launch/viewer above, after rechecking its identity.
  let ids = sandboxIds();
  let rows = sandboxProcesses();
  adopt(rows, true);
  if (ownVmId && ids.includes(ownVmId)) {
    assert.ok(
      ownRemote && owned.get(ownRemote.pid) === ownRemote.created,
      'Sandbox VM ownership was not established',
    );
    ps(
      `& ${psLiteral(sandboxCli)} stop --id ${psLiteral(ownVmId)}; if ($LASTEXITCODE -ne 0) { throw 'Stopping owned Sandbox VM failed' }`,
    );
  }
  const deadline = Date.now() + 30000;
  do {
    ids = sandboxIds();
    rows = sandboxProcesses();
    adopt(rows, true);
    const vmGone = ownVmId ? !ids.includes(ownVmId) : ids.length === 0;
    const remote = ownRemote && rows.find((row) => row.pid === ownRemote.pid);
    if (vmGone && remote) {
      assert.ok(ownVmId, 'Cannot close a viewer without verified VM ownership');
      assert.deepEqual(
        remoteIdentity(remote),
        ownRemote,
        'Sandbox viewer identity changed before cleanup',
      );
      // The official stop command can leave its viewer alive. After the VM is
      // gone, close only this exact owned viewer. Holding its process handle
      // while rechecking CIM identity prevents a recycled PID becoming a target.
      ps(`
        $process = Get-Process -Id ${ownRemote.pid} -ErrorAction SilentlyContinue
        if ($null -ne $process) {
          try {
            $null = $process.Handle
            $current = Get-CimInstance Win32_Process -Filter "ProcessId=${ownRemote.pid}"
            if ($null -eq $current -or $current.Name -ine 'WindowsSandboxRemoteSession.exe' -or
                $current.ParentProcessId -ne ${ownRemote.parent} -or
                $current.CreationDate.ToUniversalTime().ToString('o') -cne ${psLiteral(ownRemote.created)} -or
                $current.ExecutablePath -ine ${psLiteral(ownRemote.path)}) { throw 'Owned Sandbox viewer identity changed' }
            $process.Kill()
            if (-not $process.WaitForExit(10000)) { throw 'Owned Sandbox viewer did not exit' }
          } finally { $process.Dispose() }
        }
      `);
      rows = sandboxProcesses();
      adopt(rows, true);
    }
    if (vmGone && !rows.some((row) => !isServer(row) && owned.has(row.pid))) break;
    await delay(1000);
  } while (Date.now() < deadline);
  assert.ok(
    ownVmId ? !ids.includes(ownVmId) : ids.length === 0,
    'Sandbox VM did not shut down or ownership is unknown; temporary mapping retained',
  );
  assert.equal(
    rows.filter((row) => !isServer(row) && owned.has(row.pid)).length,
    0,
    'Owned Sandbox viewer did not exit; temporary mapping retained',
  );
}
async function requireNoStopRequest() {
  const info = await lstat(control).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
  });
  if (!info) return;
  assert.ok(info.isFile() && !info.isSymbolicLink() && info.size <= 64, 'Unsafe stop request');
  assert.equal(await readFile(control, 'utf8'), nonce, 'Unexpected stop request owner');
  throw Error('Store Sandbox verification cancelled by its owner');
}
async function ordinary(file) {
  const info = await lstat(file);
  assert.ok(info.isFile() && !info.isSymbolicLink(), 'Expected a regular file: ' + file);
  assert.equal(path.relative(file, await realpath(file)), '', 'Redirected input: ' + file);
}
async function hash(file, algorithm = 'sha256', encoding = 'hex') {
  const digest = createHash(algorithm);
  for await (const chunk of createReadStream(file)) digest.update(chunk);
  return digest.digest(encoding);
}
async function licenseDigests() {
  const digests = {};
  for (const name of ['LICENSE', 'THIRD_PARTY_NOTICES.md'])
    digests[name] = await hash(path.join(repositoryRoot, name));
  return digests;
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

const guestScript = String.raw`
$ErrorActionPreference = 'Stop'
$config = Get-Content -LiteralPath 'C:\VoxCueStoreInput\config.json' -Encoding UTF8 -Raw | ConvertFrom-Json
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
function Check-Licenses($directory) {
  foreach ($name in @('LICENSE', 'THIRD_PARTY_NOTICES.md')) {
    $file = Join-Path (Join-Path $directory 'resources\licenses') $name
    if ((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant() -cne $config.licenses.$name) { throw ('Installed license mismatch: ' + $name) }
  }
}
function Assert-GuestProfilePath($file) {
  $current = [IO.Path]::GetFullPath($file)
  if (-not $current.StartsWith($guestProfile + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Profile evidence escaped the guest user' }
  while ($current -ine $guestProfile) {
    try {
      if (([IO.File]::GetAttributes($current) -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Redirected guest profile evidence' }
    } catch [IO.FileNotFoundException] {} catch [IO.DirectoryNotFoundException] {}
    $current = [IO.Path]::GetDirectoryName($current)
  }
}
try {
  Stage 'checking-guest-identity'
  $guestIdentity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $guestSid = $guestIdentity.User.Value
  if ($guestIdentity.Name.Split('\')[-1] -ine 'WDAGUtilityAccount' -or
      $config.hostSid -notmatch '^S-\d+(?:-\d+)+$' -or $guestSid -eq $config.hostSid) { throw 'Native acceptance requires a separate Windows Sandbox account' }
  $guestProfile = [IO.Path]::GetFullPath([Environment]::GetFolderPath([Environment+SpecialFolder]::UserProfile))
  if ($guestProfile -ine 'C:\Users\WDAGUtilityAccount') { throw 'Unexpected Sandbox user profile' }
  foreach ($directory in @('C:\', 'C:\Users', $guestProfile)) {
    $info = Get-Item -LiteralPath $directory -Force
    if (-not $info.PSIsContainer -or ($info.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or
        [IO.Path]::GetFullPath($info.FullName) -ine $directory) { throw 'Redirected Sandbox user profile' }
  }
  $result.guestSid = $guestSid
  $result.guestProfile = $guestProfile
  New-Item -ItemType Directory -Path $work | Out-Null
  # An independent guest watchdog also shuts down if install or inspection hangs.
  $watch = '$end=(Get-Date).AddMinutes(12); while((Get-Date)-lt $end){if(Test-Path -LiteralPath "C:\VoxCueStoreOutput\stop"){break};Start-Sleep -Seconds 1};& "$env:WINDIR\System32\shutdown.exe" /s /t 0 /f'
  $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($watch))
  Start-Process -FilePath (Join-Path $PSHOME 'powershell.exe') -ArgumentList @('-NoProfile','-NonInteractive','-EncodedCommand',$encoded) -WindowStyle Hidden | Out-Null
  if ($config.task -eq 'copilot-vault') {
    Stage 'checking-copilot-vault'
    $probeFile = Join-Path $work 'copilot-vault.json'
    $inspection = New-Object Diagnostics.Process
    $inspectionStarted = $false
    try {
      $inspection.StartInfo.FileName = 'C:\VoxCueStoreInput\tools\node.exe'
      $inspection.StartInfo.Arguments = '"C:\VoxCueStoreInput\probe.cjs" "C:\VoxCueStoreInput\config.json" "' + $probeFile + '" "' + $work + '"'
      $inspection.StartInfo.WorkingDirectory = $work
      $inspection.StartInfo.UseShellExecute = $false
      $inspection.StartInfo.CreateNoWindow = $true
      $inspection.StartInfo.RedirectStandardOutput = $true
      $inspection.StartInfo.RedirectStandardError = $true
      $inspectionStarted = $inspection.Start()
      if (-not $inspectionStarted) { throw 'Starting Copilot vault probe failed' }
      $stdoutTask = $inspection.StandardOutput.ReadToEndAsync()
      $stderrTask = $inspection.StandardError.ReadToEndAsync()
      $timedOut = -not $inspection.WaitForExit(180000)
      if ($timedOut) {
        $inspection.Kill()
        if (-not $inspection.WaitForExit(10000)) { throw 'Timed-out Copilot vault probe did not exit' }
      }
      if (-not [Threading.Tasks.Task]::WaitAll([Threading.Tasks.Task[]]@($stdoutTask, $stderrTask), 10000)) { throw 'Copilot vault pipe capture timed out' }
      # Drain both streams without returning runtime diagnostics or fake tokens.
      $null = $stdoutTask.GetAwaiter().GetResult()
      $null = $stderrTask.GetAwaiter().GetResult()
      $result.exitCode = $inspection.ExitCode
      if ($timedOut) { throw ('Copilot vault probe timed out (exitCode=' + $inspection.ExitCode + ')') }
    } finally {
      try {
        if ($inspectionStarted -and -not $inspection.HasExited) {
          $inspection.Kill()
          if (-not $inspection.WaitForExit(10000)) { throw 'Copilot vault probe cleanup timed out' }
        }
      } finally { $inspection.Dispose() }
    }
    if (-not (Test-Path -LiteralPath $probeFile -PathType Leaf) -or (Get-Item -LiteralPath $probeFile).Length -gt 4096) { throw 'Sanitized Copilot vault result is missing or oversized' }
    $probeResult = Get-Content -LiteralPath $probeFile -Encoding UTF8 -Raw | ConvertFrom-Json
    if ($probeResult.nonce -cne $config.nonce -or $probeResult.ok -isnot [bool]) { throw 'Unexpected Copilot vault result owner or status' }
    if (-not $probeResult.ok -or $result.exitCode -ne 0) {
      if ($probeResult.stage -match '^[a-z0-9-]{1,80}$') { $result.probeStage = $probeResult.stage }
      if ($probeResult.errorType -match '^[A-Za-z0-9.]{1,80}$') { $result.errorType = $probeResult.errorType }
      throw ('Copilot vault probe failed (exitCode=' + $result.exitCode + ')')
    }
    foreach ($field in @('sharedSlot', 'crossLogout', 'removedCliSlot', 'preservedCliAfterVoxCueLogout', 'localSessionCleared', 'storedInVault', 'plaintext')) {
      if ($probeResult.$field -isnot [bool]) { throw 'Invalid sanitized Copilot vault result' }
      $result[$field] = $probeResult.$field
    }
    $result.task = 'copilot-vault'
    $result.ok = $true
    $result.stage = 'complete'
  } elseif ($config.task -in @('nsis-current', 'nsis-upgrade')) {
    $target = Join-Path $env:LOCALAPPDATA 'Programs\VoxCue'
    $exe = Join-Path $target 'VoxCue.exe'
    $profileMarker = Join-Path $env:APPDATA 'VoxCue\local-mode.json'
    Assert-GuestProfilePath $target
    Assert-GuestProfilePath $profileMarker
    if ((Test-Path -LiteralPath $target) -or (Test-Path -LiteralPath $profileMarker)) { throw 'NSIS guest is not clean' }
    function Registration {
      # electron-builder NsisTarget includes both product name and version by default.
      $names = @('VoxCue ' + $config.version)
      if ($config.previous) { $names += 'VoxCue ' + $config.previous.version }
      @(Get-ChildItem -LiteralPath 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall' -ErrorAction SilentlyContinue |
        Get-ItemProperty | Where-Object { $_.DisplayName -in $names })
    }
    if ((Registration).Count -ne 0) { throw 'VoxCue was already registered in the guest' }
    if ($config.ragDirectory) {
      if ($config.task -cne 'nsis-upgrade' -or $config.previous.version -cne '1.2.0' -or
          $config.ragDirectory -cnotmatch '^rag-1\.0\.0-[a-f0-9]{64}$') { throw 'Unexpected upgrade component' }
      $cache = Join-Path ([IO.Path]::GetDirectoryName($profileMarker)) 'component-cache'
      Assert-GuestProfilePath $cache
      if (Test-Path -LiteralPath $cache) { throw 'Upgrade fixture requires a fresh component cache' }
      $null = New-Item -ItemType Directory -Path $cache -Force
      Copy-Item -LiteralPath (Join-Path 'C:\VoxCueStoreInput' $config.ragDirectory) -Destination $cache -Recurse
    }
    $installers = @($config.current)
    if ($config.task -eq 'nsis-upgrade') { $installers = @($config.previous, $config.current) }
    foreach ($item in $installers) {
      $source = Join-Path 'C:\VoxCueStoreInput' $item.name
      if ((Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant() -cne $item.sha256) { throw 'Mapped NSIS checksum mismatch' }
      Copy-Item -LiteralPath $source -Destination (Join-Path $work $item.name)
      if ((Get-FileHash -LiteralPath (Join-Path $work $item.name) -Algorithm SHA256).Hash.ToLowerInvariant() -cne $item.sha256) { throw 'Guest NSIS copy changed' }
    }
    function Install-Nsis($item, $upgrade) {
      Stage ('installing-nsis-' + $item.version)
      Assert-GuestProfilePath $target
      $arguments = if ($upgrade) { '/S --updated' } else { '/S /D=' + $target }
      $installer = Start-Process -FilePath (Join-Path $work $item.name) -ArgumentList $arguments -PassThru -WindowStyle Hidden
      try {
        $null = $installer.Handle
        if (-not $installer.WaitForExit(120000)) { throw 'NSIS installer did not exit naturally' }
        if ($installer.ExitCode -ne 0) { throw ('NSIS installation failed: ' + $installer.ExitCode) }
      } finally { $installer.Dispose() }
      Assert-GuestProfilePath $exe
      $registration = @(Registration)
      if ($registration.Count -ne 1 -or $registration[0].DisplayName -cne ('VoxCue ' + $item.version) -or $registration[0].DisplayVersion -cne $item.version -or
          $registration[0].UninstallString -cne ('"' + (Join-Path $target 'Uninstall VoxCue.exe') + '" /currentuser')) { throw 'Unexpected NSIS uninstall registration' }
      $key = $registration[0].PSChildName
      if ($key -notmatch '^[a-f0-9-]{36}$') { throw 'Unexpected NSIS installation identity' }
      $location = (Get-ItemProperty -LiteralPath ('HKCU:\Software\' + $key)).InstallLocation
      if ([IO.Path]::GetFullPath($location).TrimEnd('\') -ine $target) { throw 'NSIS installation changed directory' }
      $info = Get-Item -LiteralPath $exe
      if ($info.PSIsContainer -or $info.VersionInfo.ProductVersion -notmatch ('^' + [regex]::Escape($item.version) + '(?:\.0)?$')) { throw 'Installed NSIS executable version mismatch' }
      if ($item.version -eq $config.version -and
          (Get-FileHash -LiteralPath (Join-Path $target 'resources\app.asar') -Algorithm SHA256).Hash.ToLowerInvariant() -cne $config.asarSha256) { throw 'Installed final ASAR differs from the accepted staging payload' }
      if ($item.version -eq $config.version) { Check-Licenses $target }
      return $key
    }
    $phases = New-Object Collections.Generic.List[string]
    $result.nsisExitObservations = New-Object Collections.Generic.List[object]
    function Nsis-PackagedProcesses {
      @(Get-CimInstance Win32_Process -OperationTimeoutSec 1 | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($target + '\', [StringComparison]::OrdinalIgnoreCase) } | Sort-Object ProcessId)
    }
    function Nsis-ProcessMetadata($rows) {
      @($rows | ForEach-Object {
        $kind = 'other'
        if ($_.Name -ieq 'copilot-runtime.exe') { $kind = 'copilot-sdk' }
        elseif ($_.Name -ieq 'codex.exe') { $kind = 'codex-sdk' }
        elseif ($_.CommandLine -match '(?:^|\s)--type=(renderer|gpu-process|utility|crashpad-handler)(?:\s|$)') { $kind = $Matches[1] }
        @{pid=[int]$_.ProcessId; parentPid=[int]$_.ParentProcessId; name=$_.Name; kind=$kind;
          relativeExe=$_.ExecutablePath.Substring($target.Length + 1); createdUtc=$_.CreationDate.ToUniversalTime().ToString('o')}
      })
    }
    function Check-NsisRenderer($expectedVersion, $phase, $bindings) {
      Stage ('checking-nsis-' + $expectedVersion + '-' + $phase)
      Assert-GuestProfilePath $exe
      $beforeLaunch = @(Nsis-PackagedProcesses)
      if ($beforeLaunch.Count -ne 0) {
        $result.nsisBeforeLaunchProcesses = @(Nsis-ProcessMetadata $beforeLaunch)
        throw 'NSIS application had packaged processes before cold launch'
      }
      $launchUtc = [DateTime]::UtcNow
      $app = Start-Process -FilePath $exe -ArgumentList '--remote-debugging-port=9222 --remote-debugging-address=127.0.0.1' -PassThru -WindowStyle Hidden
      try {
        $null = $app.Handle
        $browser = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $app.Id)
        if (-not $browser -or $browser.ExecutablePath -ine $exe -or
            $browser.CreationDate.ToUniversalTime() -lt $launchUtc.AddSeconds(-1)) { throw 'NSIS browser process identity mismatch' }
        $owner = Invoke-CimMethod -InputObject $browser -MethodName GetOwnerSid
        if ($owner.ReturnValue -ne 0 -or $owner.Sid -cne $guestSid) { throw 'NSIS process escaped the guest account' }
        $runtimeConfig = Join-Path $work 'renderer-config.json'
        $runtimeFile = Join-Path $work ('runtime-' + $phases.Count + '.json')
        $options = @{nonce=$config.nonce; distribution='nsis'; appDirectory=$target; version=$expectedVersion;
          phase=$phase; bindings=$bindings; expectedPid=$app.Id; close=$true}
        if ($config.ragDirectory) { $options.checkRag = $true; $options.ragRevision = $result.ragRevision }
        [IO.File]::WriteAllText($runtimeConfig, ($options | ConvertTo-Json -Depth 10 -Compress), (New-Object Text.UTF8Encoding $false))
        $inspection = New-Object Diagnostics.Process
        $inspectionStarted = $false
        try {
          $inspection.StartInfo.FileName = 'C:\VoxCueStoreInput\tools\node.exe'
          $inspection.StartInfo.Arguments = '"C:\VoxCueStoreInput\renderer.mjs" "' + $runtimeConfig + '" "' + $runtimeFile + '"'
          $inspection.StartInfo.WorkingDirectory = $work
          $inspection.StartInfo.UseShellExecute = $false
          $inspection.StartInfo.CreateNoWindow = $true
          $inspection.StartInfo.RedirectStandardOutput = $true
          $inspection.StartInfo.RedirectStandardError = $true
          $inspection.StartInfo.StandardOutputEncoding = New-Object Text.UTF8Encoding $false
          $inspection.StartInfo.StandardErrorEncoding = New-Object Text.UTF8Encoding $false
          $inspectionStarted = $inspection.Start()
          if (-not $inspectionStarted) { throw 'Starting NSIS renderer inspector failed' }
          $stdout = $inspection.StandardOutput.ReadToEndAsync()
          $stderr = $inspection.StandardError.ReadToEndAsync()
          if (-not $inspection.WaitForExit(180000)) { throw 'NSIS renderer inspection timed out' }
          if (-not [Threading.Tasks.Task]::WaitAll([Threading.Tasks.Task[]]@($stdout, $stderr), 10000)) { throw 'NSIS inspector pipe capture timed out' }
          $null = $stdout.GetAwaiter().GetResult()
          $diagnostic = $stderr.GetAwaiter().GetResult()
          if ($inspection.ExitCode -ne 0) { throw ('NSIS renderer check failed: ' + $diagnostic) }
        } finally {
          try {
            if ($inspectionStarted -and -not $inspection.HasExited) {
              $inspection.Kill()
              if (-not $inspection.WaitForExit(10000)) { throw 'NSIS inspector cleanup timed out' }
            }
          } finally { $inspection.Dispose() }
        }
        if (-not (Test-Path -LiteralPath $runtimeFile -PathType Leaf) -or (Get-Item -LiteralPath $runtimeFile).Length -gt 16384) { throw 'Missing or oversized NSIS renderer result' }
        $runtime = Get-Content -LiteralPath $runtimeFile -Encoding UTF8 -Raw | ConvertFrom-Json
        if ($runtime.nonce -cne $config.nonce -or $runtime.pid -ne $app.Id -or $runtime.version -cne $expectedVersion -or
            $runtime.phase -cne $phase -or $runtime.persistence -isnot [bool] -or -not $runtime.persistence) { throw 'Invalid NSIS renderer result' }
        if ($config.ragDirectory) {
          if ($runtime.ragRevision -cnotmatch '^[a-f0-9]{64}$' -or
              ($phase -ceq 'verify' -and $runtime.ragRevision -cne $result.ragRevision)) { throw 'Upgrade changed the seeded RAG revision' }
          $result.ragRevision = $runtime.ragRevision
        }
        # Never kill a product process and call that a successful flush/upgrade.
        # Main and descendants share the original 30s budget; an early main exit
        # must not turn the first CIM snapshot into a zero-grace child assertion.
        $quitWatch = [Diagnostics.Stopwatch]::StartNew()
        $observation = @{version=$expectedVersion; phase=$phase; mainPid=$app.Id;
          snapshots=(New-Object Collections.Generic.List[object]); truncated=$false}
        $result.nsisExitObservations.Add($observation)
        $remaining = @(Nsis-PackagedProcesses)
        $observation.snapshots.Add(@{elapsedMs=$quitWatch.ElapsedMilliseconds; processes=@(Nsis-ProcessMetadata $remaining)})
        $lastIdentity = ($remaining | ForEach-Object { [string]$_.ProcessId + ':' + $_.CreationDate.ToUniversalTime().ToString('o') }) -join '|'
        $mainBudget = [Math]::Max(0, 30000 - $quitWatch.ElapsedMilliseconds)
        if (-not $app.WaitForExit([int]$mainBudget)) { throw 'NSIS application did not exit naturally after saving' }
        $observation.mainExitedAtMs = $quitWatch.ElapsedMilliseconds
        if ($app.ExitCode -ne 0) { throw ('NSIS application failed during exit: ' + $app.ExitCode) }
        while ($quitWatch.ElapsedMilliseconds -lt 30000) {
          $remaining = @(Nsis-PackagedProcesses)
          $identity = ($remaining | ForEach-Object { [string]$_.ProcessId + ':' + $_.CreationDate.ToUniversalTime().ToString('o') }) -join '|'
          $observation.last = @{elapsedMs=$quitWatch.ElapsedMilliseconds; processes=@(Nsis-ProcessMetadata $remaining)}
          if ($identity -cne $lastIdentity) {
            if ($observation.snapshots.Count -lt 16) { $observation.snapshots.Add($observation.last) }
            else { $observation.truncated = $true }
            $lastIdentity = $identity
          }
          if ($remaining.Count -eq 0) { break }
          $sleep = [Math]::Min(250, 30000 - $quitWatch.ElapsedMilliseconds)
          if ($sleep -gt 0) { Start-Sleep -Milliseconds ([int]$sleep) }
        }
        $observation.elapsedMs = $quitWatch.ElapsedMilliseconds
        if ($remaining.Count -ne 0 -or $quitWatch.ElapsedMilliseconds -gt 30000) { throw 'NSIS application left a running packaged subprocess after the shared 30s exit budget' }
        Assert-GuestProfilePath $profileMarker
        $localMode = Get-Content -LiteralPath $profileMarker -Encoding UTF8 -Raw | ConvertFrom-Json
        if ($localMode -isnot [bool] -or -not $localMode) { throw 'NSIS backend did not use the real guest profile' }
        $phases.Add($expectedVersion + ':' + $phase)
        return $runtime.bindings
      } finally { $app.Dispose() }
    }
    if ($config.task -eq 'nsis-upgrade') {
      $registrationKey = Install-Nsis $config.previous $false
      $bindings = Check-NsisRenderer $config.previous.version 'seed' $null
      $updatedKey = Install-Nsis $config.current $true
      if ($updatedKey -cne $registrationKey) { throw 'NSIS upgrade changed its registry identity' }
      $bindings = Check-NsisRenderer $config.version 'verify' $bindings
    } else {
      $registrationKey = Install-Nsis $config.current $false
      $bindings = Check-NsisRenderer $config.version 'seed' $null
    }
    $null = Check-NsisRenderer $config.version 'verify' $bindings
    foreach ($item in $installers) {
      if ((Get-FileHash -LiteralPath (Join-Path 'C:\VoxCueStoreInput' $item.name) -Algorithm SHA256).Hash.ToLowerInvariant() -cne $item.sha256) { throw 'Read-only NSIS source changed' }
    }
    $result.task = $config.task
    $result.appVersion = $config.version
    $result.previousVersion = if ($config.task -eq 'nsis-upgrade') { $config.previous.version } else { $null }
    $result.phases = $phases.ToArray()
    $result.installDirectory = $target
    $result.userData = [IO.Path]::GetDirectoryName($profileMarker)
    $result.registrationKey = $registrationKey
    $result.persistence = $true
    $result.naturalExits = $true
    $result.sourceUnchanged = $true
    $result.ok = $true
    $result.stage = 'complete'
  } else {
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
  $appDirectory = Split-Path -Parent $exe
  Check-Licenses $appDirectory
  $profileMarkers = @(
    (Join-Path ([Environment]::GetFolderPath([Environment+SpecialFolder]::ApplicationData)) 'VoxCue\local-mode.json'),
    (Join-Path ([Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)) ('Packages\' + $package.PackageFamilyName + '\LocalCache\Roaming\VoxCue\local-mode.json'))
  )
  foreach ($marker in $profileMarkers) {
    Assert-GuestProfilePath $marker
    if (Test-Path -LiteralPath $marker) { throw 'Guest local-mode preference existed before launch' }
  }
  $runtimeConfig = Join-Path $work 'renderer-config.json'
  $config | Add-Member -NotePropertyName appDirectory -NotePropertyValue $appDirectory
  [IO.File]::WriteAllText($runtimeConfig, ($config | ConvertTo-Json -Compress), (New-Object Text.UTF8Encoding $false))
  Stage 'launching-package-identity'
  Get-Command Invoke-CommandInDesktopPackage -ErrorAction Stop | Out-Null
  $launchUtc = [DateTime]::UtcNow
  Invoke-CommandInDesktopPackage -PackageFamilyName $package.PackageFamilyName -AppId $applications[0].Id -Command $exe -Args '--remote-debugging-port=9222 --remote-debugging-address=127.0.0.1' -PreventBreakaway
  Stage 'checking-real-store-runtime'
  $runtimeFile = Join-Path $work 'runtime.json'
  # WinPS 5 converts native stderr into ErrorRecords; with Stop this can discard
  # everything after the first stack line. Drain both native pipes concurrently.
  $inspection = New-Object Diagnostics.Process
  $inspectionStarted = $false
  try {
    $inspection.StartInfo.FileName = 'C:\VoxCueStoreInput\tools\node.exe'
    $inspection.StartInfo.Arguments = '"C:\VoxCueStoreInput\renderer.mjs" "' + $runtimeConfig + '" "' + $runtimeFile + '"'
    $inspection.StartInfo.WorkingDirectory = $work
    $inspection.StartInfo.UseShellExecute = $false
    $inspection.StartInfo.CreateNoWindow = $true
    $inspection.StartInfo.RedirectStandardOutput = $true
    $inspection.StartInfo.RedirectStandardError = $true
    $inspection.StartInfo.StandardOutputEncoding = New-Object Text.UTF8Encoding $false
    $inspection.StartInfo.StandardErrorEncoding = New-Object Text.UTF8Encoding $false
    $inspectionStarted = $inspection.Start()
    if (-not $inspectionStarted) { throw 'Starting Store inspector failed' }
    $stdoutTask = $inspection.StandardOutput.ReadToEndAsync()
    $stderrTask = $inspection.StandardError.ReadToEndAsync()
    $timedOut = -not $inspection.WaitForExit(180000)
    if ($timedOut) {
      $inspection.Kill()
      if (-not $inspection.WaitForExit(10000)) { throw 'Timed-out Store inspector did not exit' }
    }
    if (-not [Threading.Tasks.Task]::WaitAll([Threading.Tasks.Task[]]@($stdoutTask, $stderrTask), 10000)) { throw 'Store inspector diagnostic capture timed out' }
    $stdout = $stdoutTask.GetAwaiter().GetResult()
    $stderr = $stderrTask.GetAwaiter().GetResult()
    $diagnostic = ('exitCode=' + $inspection.ExitCode + [Environment]::NewLine + 'stdout:' + [Environment]::NewLine + $stdout + [Environment]::NewLine + 'stderr:' + [Environment]::NewLine + $stderr)
    if ($timedOut) { throw ('Installed runtime verification timed out: ' + $diagnostic) }
    if ($inspection.ExitCode -ne 0) { throw ('Installed runtime verification failed: ' + $diagnostic) }
  } finally {
    try {
      if ($inspectionStarted -and -not $inspection.HasExited) {
        $inspection.Kill()
        if (-not $inspection.WaitForExit(10000)) { throw 'Store inspector cleanup timed out' }
      }
    } finally { $inspection.Dispose() }
  }
  $runtime = Get-Content -LiteralPath $runtimeFile -Encoding UTF8 -Raw | ConvertFrom-Json
  if ($runtime.nonce -ne $config.nonce -or $runtime.version -ne $config.version -or $runtime.pid -le 0) { throw 'Invalid installed Store runtime result' }
  # Check the actual browser PID's Windows package identity without reopening
  # the main-process inspector disabled by production fuses.
  Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class PackageProcess {
  [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] static extern int GetPackageFullName(IntPtr process, ref uint length, StringBuilder name);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  public static string Identity(uint pid) {
    IntPtr handle=OpenProcess(0x1000, false, pid);
    if(handle==IntPtr.Zero) throw new Exception("Browser process handle unavailable");
    try { uint length=0; int result=GetPackageFullName(handle, ref length, null);
      if(result!=122 || length==0) throw new Exception("Browser has no package identity");
      var name=new StringBuilder((int)length);
      if(GetPackageFullName(handle, ref length, name)!=0) throw new Exception("Browser package identity unavailable");
      return name.ToString();
    } finally { CloseHandle(handle); }
  }
}
'@
  if ([PackageProcess]::Identity([uint32]$runtime.pid) -cne $package.PackageFullName) { throw 'Browser process is not the installed Store package' }
  # Public setLocalMode(true) writes JSON true via LocalMode constructed from
  # app.getPath('userData'). This observes the real backend path, not a CLI flag.
  $written = @($profileMarkers | Where-Object { Test-Path -LiteralPath $_ })
  if ($written.Count -ne 1) { throw 'Expected exactly one newly written guest local-mode preference' }
  $profileMarker = $written[0]
  Assert-GuestProfilePath $profileMarker
  $info = Get-Item -LiteralPath $profileMarker -Force
  if ($info.PSIsContainer -or $info.Length -gt 16 -or $info.CreationTimeUtc -lt $launchUtc -or
      $info.LastWriteTimeUtc -lt $launchUtc) { throw 'Invalid or stale guest local-mode preference' }
  $localMode = Get-Content -LiteralPath $profileMarker -Encoding UTF8 -Raw | ConvertFrom-Json
  if ($localMode -isnot [bool] -or $localMode -ne $true) { throw 'Backend did not persist the selected local mode' }
  if ((Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant() -ne $config.sha256) { throw 'Read-only source APPX changed' }
  if ($runtime.persistence -isnot [bool] -or -not $runtime.persistence) { throw 'Packaged renderer persistence regression failed' }
  Stage 'checking-package-native-modules'
  # WindowsApps executables must be exercised in the package's execution context.
  # Keep results outside virtualized AppData; only this sanitized nonce file is mapped.
  $nativeFile = Join-Path $output ('package-native-' + $config.nonce + '.json')
  $nativeArgs = '"C:\VoxCueStoreInput\package-native-check.cjs" "' + $runtimeConfig + '" "' + $nativeFile + '" "' + $work + '"'
  Invoke-CommandInDesktopPackage -PackageFamilyName $package.PackageFamilyName -AppId $applications[0].Id -Command 'C:\VoxCueStoreInput\tools\electron\electron.exe' -Args $nativeArgs -PreventBreakaway
  $nativeDeadline = [DateTime]::UtcNow.AddSeconds(240)
  while (-not (Test-Path -LiteralPath $nativeFile -PathType Leaf)) {
    if ([DateTime]::UtcNow -gt $nativeDeadline) { throw 'Package native checks timed out' }
    if (Test-Path -LiteralPath (Join-Path $output 'stop')) { throw 'Host requested Sandbox shutdown' }
    Start-Sleep -Milliseconds 250
  }
  if ((Get-Item -LiteralPath $nativeFile).Length -gt 4096) { throw 'Sanitized package native result is oversized' }
  $native = Get-Content -LiteralPath $nativeFile -Encoding UTF8 -Raw | ConvertFrom-Json
  if ($native.nonce -cne $config.nonce -or $native.ok -isnot [bool]) { throw 'Invalid package native result owner or status' }
  if (-not $native.ok) {
      if ($native.phase -match '^[a-z0-9-]{1,80}$') { $result.nativePhase = $native.phase }
      if ($native.errorType -match '^[A-Za-z0-9.]{1,80}$') { $result.errorType = $native.errorType }
      if ($native.errorReason -match '^[a-z0-9-]{1,80}$') { $result.nativeReason = $native.errorReason }
      if ($native.captureStep -match '^(background|color-[012]|cancel|overlay-(visible|protected))-[a-z-]{1,40}$') { $result.captureStep = $native.captureStep }
      if ($native.errorCode -match '^(ENOENT|EACCES|EPERM|ENOTDIR|EISDIR|ETIMEDOUT|ECONNREFUSED|ECONNRESET|EPIPE)$') { $result.nativeCode = $native.errorCode }
      if ($native.runtimeExitCode -is [int] -or $native.runtimeExitCode -is [long]) { $result.runtimeExitCode = $native.runtimeExitCode }
      if ($native.knowledgeDiagnostic -match '^[a-z0-9-]{1,80}$') { $result.knowledgeDiagnostic = $native.knowledgeDiagnostic }
      if ($native.knowledgeExitCode -is [int] -or $native.knowledgeExitCode -is [long]) { $result.knowledgeExitCode = $native.knowledgeExitCode }
      foreach ($name in @('vcruntime140', 'vcruntime140_1', 'msvcp140', 'msvcp140_1', 'msvcp140_atomic_wait')) {
        if ($native.msvcRuntime.$name -is [bool]) { $result[('crt_' + $name)] = $native.msvcRuntime.$name }
      }
      if ($native.sourceLine -is [int] -and $native.sourceLine -gt 0 -and $native.sourceLine -lt 10000) { $result.nativeLine = $native.sourceLine }
      throw 'Packaged native regression failed'
  }
  foreach ($field in @('finalAsar', 'nativeVault', 'copilotRuntime', 'codexEmptyKeyring', 'codexSyntheticToken', 'asrWorker', 'asrGapReset', 'speechUtility', 'knowledgeFormats', 'knowledgeModes', 'knowledgeRestart', 'knowledgeDelete', 'mobileAssets', 'screenshotWorker', 'screenshotCapture')) {
    if ($native.$field -isnot [bool] -or -not $native.$field) { throw ('Missing packaged native check: ' + $field) }
    $result[$field] = $true
  }
  $result.persistence = $true
  $systemVcRuntimeAbsent = $true
  foreach ($name in @('vcruntime140', 'vcruntime140_1', 'msvcp140', 'msvcp140_1', 'msvcp140_atomic_wait')) {
    if ($native.msvcRuntime.$name -isnot [bool]) { throw 'Missing system CRT diagnostic' }
    if ($native.msvcRuntime.$name) { $systemVcRuntimeAbsent = $false }
  }
  $result.systemVcRuntimeAbsent = $systemVcRuntimeAbsent
  $result.ok = $true
  $result.stage = 'complete'
  $result.packageVersion = $package.Version.ToString()
  $result.packageFamilyName = $package.PackageFamilyName
  $result.appVersion = $runtime.version
  $result.windowsStore = $true
  $result.packaged = $true
  $result.guestSid = $guestSid
  $result.guestProfile = $guestProfile
  $result.userData = [IO.Path]::GetDirectoryName($profileMarker)
  $result.updatePhases = $runtime.updatePhases
  $result.sourceUnchanged = $true
  }
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
  if (!copilotVault) await ordinary(artifact);
  if (!copilotVault && appxArgument) {
    const relative = path.relative(temporary, artifact).split(path.sep);
    assert.ok(
      relative.length > 1 && relative[0].startsWith('voxcue-test-run-') && !relative.includes('..'),
      'Temporary APPX must belong to a test-workspace run',
    );
    const ownerRoot = path.join(temporary, relative[0]);
    assert.equal(await realpath(ownerRoot), ownerRoot, 'Redirected APPX owner');
    const marker = path.join(ownerRoot, '.voxcue-test-owner.json');
    await ordinary(marker);
    const owner = JSON.parse(await readFile(marker, 'utf8'));
    assert.equal(owner.kind, 'voxcue-test-run-');
    assert.ok(Number.isSafeInteger(owner.pid) && owner.pid > 0, 'Unknown APPX owner');
    process.kill(owner.pid, 0);
  }
  await ordinary(sandboxExe);
  const cli = JSON.parse(
    ps(`
      @{source=(Get-Command wsb.exe -CommandType Application -ErrorAction Stop).Source;
        expected=(Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'Microsoft\\WindowsApps\\wsb.exe')} | ConvertTo-Json -Compress
    `),
  );
  assert.equal(
    path.resolve(cli.source).toLowerCase(),
    path.resolve(cli.expected).toLowerCase(),
    'Expected the official Windows Sandbox CLI alias',
  );
  sandboxCli = cli.source;
  const feature = JSON.parse(
    ps(
      `$feature = Get-CimInstance Win32_OptionalFeature -Filter "Name='Containers-DisposableClientVM'"
       [pscustomobject]@{present=$null -ne $feature; installState=$feature.InstallState} | ConvertTo-Json -Compress`,
    ),
  );
  assert.equal(feature.present, true, 'Windows Sandbox optional feature is unavailable');
  assert.equal(feature.installState, 1, 'Windows Sandbox must already be enabled');
  assert.deepEqual(sandboxIds(), [], 'Close existing Sandbox VMs first');
  assert.equal(
    sandboxProcesses().filter(isRemote).length,
    0,
    'Close existing Sandbox viewers first',
  );
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
  const verifiedTools = [[node, 'OpenJS Foundation']];
  let kit;
  if (!copilotVault && !nsisTask) {
    const kitRoot = path.join(platformRoot, '.cache/electron-builder/win-codesign@1.1.0');
    const kits = (await readdir(kitRoot, { withFileTypes: true })).filter(
      (entry) => entry.isDirectory() && /^windows-kits-bundle-10_0_26100_0-/.test(entry.name),
    );
    assert.equal(kits.length, 1, 'Expected the existing fixed Windows SDK tool bundle');
    kit = path.join(kitRoot, kits[0].name, 'x64');
    const signTool = path.join(kit, 'signtool.exe');
    verifiedTools.push([signTool, 'Microsoft Corporation']);
  }
  for (const [file, publisher] of verifiedTools) {
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
  hostSid = ps('[Security.Principal.WindowsIdentity]::GetCurrent().User.Value');
  assert.match(hostSid, /^S-\d+(?:-\d+)+$/);
  if (copilotVault) {
    for (const name of ['copilot-sdk', 'copilot-sdk-win32-x64']) {
      const manifest = path.join(platformRoot, 'node_modules/@github', name, 'package.json');
      await ordinary(manifest);
      assert.equal(
        JSON.parse(await readFile(manifest, 'utf8')).version,
        '1.0.21',
        'Use the fixed Copilot SDK/runtime',
      );
    }
    const runtime = path.join(input, 'runtime');
    await mkdir(runtime);
    for (const name of [
      'copilot-runtime.exe',
      'runtime.node',
      'dpapi.node',
      'msal-node-runtime.node',
      'msalruntime.dll',
    ]) {
      const source = path.join(
        platformRoot,
        'node_modules/@github/copilot-sdk-win32-x64/prebuilds/win32-x64',
        name,
      );
      await ordinary(source);
      const destination = path.join(runtime, name);
      await copyFile(source, destination);
      assert.equal(await hash(destination), await hash(source), 'Runtime copy changed');
    }
    const probe = path.join(platformRoot, 'test/scripts/copilot-vault-probe.mjs');
    const vaultTargets = path.join(platformRoot, 'test/fixtures/CopilotVaultTargets.cs');
    await ordinary(vaultTargets);
    await copyFile(vaultTargets, path.join(input, 'CopilotVaultTargets.cs'));
    await ordinary(probe);
    const requirePlatform = createRequire(path.join(platformRoot, 'package.json'));
    await requirePlatform('esbuild').build({
      entryPoints: [probe],
      outfile: path.join(input, 'probe.cjs'),
      bundle: true,
      platform: 'node',
      format: 'cjs',
      target: 'node24',
      nodePaths: [path.join(platformRoot, 'node_modules')],
      alias: { '@github/copilot-sdk': requirePlatform.resolve('@github/copilot-sdk') },
      external: ['@github/copilot-sdk-*', 'koffi'],
      legalComments: 'none',
    });
    await writeFile(
      path.join(input, 'config.json'),
      JSON.stringify({ task: 'copilot-vault', nonce, hostSid }),
    );
  } else if (nsisTask) {
    const requirePlatform = createRequire(path.join(platformRoot, 'package.json'));
    const yaml = createRequire(requirePlatform.resolve('electron-updater/package.json'))('js-yaml');
    const metadataFile = path.join(path.dirname(artifact), 'latest.yml');
    await ordinary(metadataFile);
    assert.ok((await lstat(metadataFile)).size <= 128 * 1024, 'Oversized update metadata');
    const metadata = yaml.load(await readFile(metadataFile, 'utf8'));
    assert.equal(metadata.version, version);
    const { signedWindowsUpdate } = requirePlatform(
      './dist-electron/shared/electron/backend/updates/windowsManifest.js',
    );
    const key = JSON.parse(
      await readFile(path.join(platformRoot, 'update-public-key.json'), 'utf8'),
    );
    assert.equal(key.protocol, 1);
    const selected = signedWindowsUpdate(
      metadata,
      {
        version,
        tag: 'sandbox',
        publishedAt: 0,
        manifest: 'latest.yml',
        binary: { name: path.basename(artifact), size: (await lstat(artifact)).size },
      },
      key.publicKey,
    );
    assert.equal(selected.sha512, await hash(artifact, 'sha512', 'base64'));
    originalHash = await hash(artifact);
    const current = { name: path.basename(artifact), version, sha256: originalHash };
    await copyFile(artifact, path.join(input, current.name));
    assert.equal(await hash(path.join(input, current.name)), originalHash, 'NSIS copy changed');
    let previous;
    let ragDirectory;
    if (previousArtifact) {
      await ordinary(previousArtifact);
      previousHash = await hash(previousArtifact);
      assert.equal(previousHash, previousDigest, 'Protected installer changed: ' + previousVersion);
      previous = {
        name: path.basename(previousArtifact), version: previousVersion, sha256: previousHash,
      };
      await copyFile(previousArtifact, path.join(input, previous.name));
      assert.equal(
        await hash(path.join(input, previous.name)),
        previousDigest,
        'Old NSIS copy changed',
      );
      if (previousVersion === '1.2.0') {
        const { packagesFor } = requirePlatform('./dist-electron/shared/electron/backend/components/catalog.js');
        const { componentLocation } = requirePlatform('./dist-electron/shared/electron/backend/components/service.js');
        const { verifyCachedComponent } = await import('../../../shared/test/scripts/verify-model-cache.mjs');
        const rag = packagesFor('win32', 'x64').find((item) => item.id === 'rag');
        const source = componentLocation(path.join(platformRoot, '.cache/test-components'), rag);
        await verifyCachedComponent(source, rag);
        const target = componentLocation(input, rag);
        ragDirectory = path.basename(target);
        for (const relative of ['.voxcue-component.json', ...rag.files.map((file) => 'files/' + file.path)]) {
          const destination = path.join(target, relative);
          await mkdir(path.dirname(destination), { recursive: true });
          await copyFile(path.join(source, relative), destination);
        }
        await verifyCachedComponent(target, rag);
      }
    }
    const archive = path.join(
      platformRoot,
      'release/installer-stage/VoxCue-win32-x64/resources/app.asar',
    );
    await ordinary(archive);
    await writeFile(
      path.join(input, 'config.json'),
      JSON.stringify({
        task: nsisTask,
        nonce,
        hostSid,
        version,
        current,
        previous,
        ragDirectory,
        asarSha256: await hash(archive),
        licenses: await licenseDigests(),
      }),
    );
    await copyFile(
      path.join(platformRoot, 'test/scripts/store-renderer-client.mjs'),
      path.join(input, 'renderer.mjs'),
    );
  } else {
    const requirePlatform = createRequire(path.join(platformRoot, 'package.json'));
    const electron = await realpath(requirePlatform('electron'));
    await ordinary(electron);
    const expected = requirePlatform('electron/package.json').version;
    assert.equal(expected, requirePlatform('../shared/package.json').devDependencies.electron);
    await cp(path.dirname(electron), path.join(tools, 'electron'), {
      recursive: true,
      errorOnExist: true,
      force: false,
    });
    assert.equal(await hash(path.join(tools, 'electron/electron.exe')), await hash(electron));
    const { prepareModelFixtures } =
      await import('../../../shared/test/scripts/model-fixtures.mjs');
    const models = await prepareModelFixtures();
    const fixtureDirectory = path.join(input, 'fixtures');
    await mkdir(fixtureDirectory);
    execFileSync(
      path.join(framework, 'csc.exe'),
      [
        '/nologo', '/platform:x64', '/target:exe',
        '/out:' + path.join(fixtureDirectory, 'SyntheticPlayback.exe'),
        path.join(platformRoot, 'test/fixtures/SyntheticPlayback.cs'),
      ],
      { windowsHide: true, timeout: 30000, stdio: 'pipe' },
    );
    for (const [source, name] of [
      [models.speechModels, 'speech'],
      [models.ragModel, 'rag'],
    ])
      await cp(source, path.join(fixtureDirectory, name), {
        recursive: true,
        errorOnExist: true,
        force: false,
      });
    await copyFile(
      path.join(models.speechFixtures, 'english.wav'),
      path.join(fixtureDirectory, 'english.wav'),
    );
    const fixtures = requirePlatform('../shared/test/scripts/rag-fixtures.cjs');
    await writeFile(path.join(fixtureDirectory, 'fixture.pdf'), fixtures.pdf());
    await writeFile(path.join(fixtureDirectory, 'fixture.docx'), await fixtures.docx());
    await writeFile(
      path.join(fixtureDirectory, 'legacy.doc'),
      fixtures.doc('pkglegacydocmarker 生产 Worker 保留中文。\r尾部参数 43。\r'),
    );
    await writeFile(
      path.join(fixtureDirectory, 'encoded-gb18030.txt'),
      Buffer.from(
        'd6aacab6bfe2cec4b5b5b1a3b4e6cfeec4bfbeadc0faa3acb4abb8d0c6f7b7b4c0a1bfd8d6c6bbfad0b5b1dba3accafdbeddb4a6c0edbde1b9fbd3c3d3dac3e6cad4d7bcb1b8a1a3d5e2b8f6cfb5cdb3d6a7b3d6d6d0cec4bacdd3a2cec4d7cac1cfa1a3',
        'hex',
      ),
    );
    await writeFile(
      path.join(fixtureDirectory, 'encoded-utf16.md'),
      Buffer.concat([
        Buffer.from([0xff, 0xfe]),
        Buffer.from('# pkgutf16marker\n\n生产 Worker 保留中文，尾部参数为 52。', 'utf16le'),
      ]),
    );
    await copyFile(
      path.join(platformRoot, 'test/scripts/package-native-check.cjs'),
      path.join(input, 'package-native-check.cjs'),
    );
    await copyFile(
      path.join(platformRoot, 'test/scripts/guest-screenshot-check.cjs'),
      path.join(input, 'guest-screenshot-check.cjs'),
    );
    await copyFile(
      path.join(repositoryRoot, 'shared/test/scripts/screenshot-worker-checks.cjs'),
      path.join(input, 'screenshot-worker-checks.cjs'),
    );
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
        hostSid,
        version,
        packageVersion,
        artifactName: path.basename(artifact),
        sha256: originalHash,
        licenses: await licenseDigests(),
        identityName: 'NCFX.VoxCue',
        publisher: 'CN=CC9C4962-FFC8-44D9-A2C0-B446CBFD375A',
        storeUpdateMessage: '此版本由 Microsoft Store 提供更新。',
        fixtureDirectory: 'C:\\VoxCueStoreInput\\fixtures',
      }),
    );
    await copyFile(
      path.join(platformRoot, 'test/scripts/store-renderer-client.mjs'),
      path.join(input, 'renderer.mjs'),
    );
  }
  await writeFile(path.join(input, 'guest.ps1'), '\uFEFF' + guestScript);
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
    sandboxIds(),
    [],
    'A Sandbox VM started during preparation; refusing to reuse it',
  );
  assert.equal(
    sandboxProcesses().filter(isRemote).length,
    0,
    'A Sandbox viewer started during preparation; refusing to reuse it',
  );
  requireDesktop();
  startedAt = Date.now();
  child = spawn(sandboxExe, [configuration], { stdio: 'ignore', windowsHide: true });
  child.once('error', (error) => {
    childError = error;
  });
  assert.ok(child.pid, 'Sandbox process did not start');
  owned.set(child.pid, null);
  console.log(label + ': starting isolated guest');
  const deadline = Date.now() + 10 * 60 * 1000;
  while (true) {
    interrupted.signal.throwIfAborted();
    requireDesktop();
    await requireNoStopRequest();
    if (childError) throw childError;
    observeSandbox();
    const status = await readResult(statusFile);
    if (status && status.stage !== lastStage) {
      console.log(label + ': ' + (lastStage = status.stage));
    }
    const result = await readResult(resultFile);
    if (result) {
      assert.ok(ownVmId && ownRemote, 'Guest result has no verified VM and viewer ownership');
      assert.equal(result.ok, true, JSON.stringify(result));
      assert.match(result.guestSid, /^S-\d+(?:-\d+)+$/);
      assert.notEqual(result.guestSid, hostSid);
      assert.equal(result.guestProfile.toLowerCase(), 'c:\\users\\wdagutilityaccount');
      if (copilotVault) {
        assert.equal(result.task, 'copilot-vault');
        assert.equal(result.exitCode, 0);
        for (const field of [
          'sharedSlot',
          'crossLogout',
          'removedCliSlot',
          'preservedCliAfterVoxCueLogout',
          'localSessionCleared',
          'storedInVault',
          'plaintext',
        ])
          assert.equal(typeof result[field], 'boolean', 'Invalid sanitized Copilot vault result');
        assert.equal(result.storedInVault, true);
        assert.equal(result.plaintext, false);
        for (const field of [
          'sharedSlot',
          'crossLogout',
          'removedCliSlot',
          'preservedCliAfterVoxCueLogout',
          'localSessionCleared',
        ])
          assert.equal(
            result[field],
            true,
            'Copilot vault reproduction or local disconnect regression failed',
          );
      } else if (nsisTask) {
        assert.equal(result.task, nsisTask);
        assert.equal(result.appVersion, version);
        assert.equal(result.previousVersion, previousVersion ?? null);
        if (previousVersion === '1.2.0') assert.match(result.ragRevision, /^[a-f0-9]{64}$/);
        assert.equal(
          result.installDirectory.toLowerCase(),
          path.win32.join(result.guestProfile, 'AppData/Local/Programs/VoxCue').toLowerCase(),
        );
        assert.equal(
          result.userData.toLowerCase(),
          path.win32.join(result.guestProfile, 'AppData/Roaming/VoxCue').toLowerCase(),
        );
        assert.match(result.registrationKey, /^[a-f0-9-]{36}$/i);
        assert.deepEqual(
          result.phases,
          previousArtifact
            ? [previousVersion + ':seed', version + ':verify', version + ':verify']
            : [version + ':seed', version + ':verify'],
        );
        for (const field of ['persistence', 'naturalExits', 'sourceUnchanged'])
          assert.equal(result[field], true);
      } else {
        assert.equal(result.packageVersion, packageVersion);
        assert.equal(result.appVersion, version);
        assert.equal(result.windowsStore, true);
        assert.equal(result.packaged, true);
        assert.match(result.packageFamilyName, /^NCFX\.VoxCue_[a-z0-9]{13}$/i);
        const profiles = [
          path.win32.join(result.guestProfile, 'AppData/Roaming/VoxCue'),
          path.win32.join(
            result.guestProfile,
            'AppData/Local/Packages',
            result.packageFamilyName,
            'LocalCache/Roaming/VoxCue',
          ),
        ];
        assert.ok(
          profiles.some((candidate) => candidate.toLowerCase() === result.userData.toLowerCase()),
          'Backend userData escaped the fixed guest profile candidates',
        );
        assert.equal(result.sourceUnchanged, true);
        assert.equal(typeof result.systemVcRuntimeAbsent, 'boolean');
        for (const field of [
          'finalAsar',
          'nativeVault',
          'copilotRuntime',
          'codexEmptyKeyring',
          'codexSyntheticToken',
          'asrWorker',
          'asrGapReset',
          'speechUtility',
          'knowledgeFormats',
          'knowledgeModes',
          'knowledgeRestart',
          'knowledgeDelete',
          'mobileAssets',
          'screenshotWorker',
          'screenshotCapture',
          'persistence',
        ])
          assert.equal(result[field], true, 'Missing packaged regression: ' + field);
        assert.deepEqual(result.updatePhases, [
          'unavailable',
          'unavailable',
          'unavailable',
          'unavailable',
        ]);
      }
      interrupted.signal.throwIfAborted();
      await requireNoStopRequest();
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
      await stopOwnedSandbox();
    }
    if (originalHash) assert.equal(await hash(artifact), originalHash, 'Original package changed');
    if (previousHash)
      assert.equal(
        await hash(previousArtifact),
        previousDigest,
        'Protected installer changed: ' + previousVersion,
      );
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
  copilotVault
    ? 'PASS Copilot vault Sandbox: sanitized isolation/logout results, guest stopped and temporary files cleaned'
    : nsisTask
      ? 'PASS NSIS Sandbox: real installation, persisted data and natural restart; guest stopped, originals unchanged, temporary files cleaned'
      : 'PASS Store Sandbox: installed identity/version, real Store runtime and disabled standalone updates; guest stopped, original unchanged, temporary files cleaned',
);

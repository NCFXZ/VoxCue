import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

export const packagedGuiIsolationMessage =
  'Production package GUI tests require OS isolation. Owner-side Electron tests accept only a known development host with an owned entry, or a verified inert installation fixture. Run packaged tests in the platform guest.';

export const syntheticElectronHtml =
  '<!doctype html><meta charset="utf-8"><title>Isolated NSIS upgrade test</title><p>NSIS fixture</p>';

// This inert test application is separate from the VoxCue product entry point.
export function syntheticElectronEntry(profile) {
  return `const {app,BrowserWindow}=require('electron');
app.setPath('userData',${JSON.stringify(profile)});
app.setPath('sessionData',${JSON.stringify(profile)});
app.whenReady().then(()=>{const win=new BrowserWindow({show:false,webPreferences:{contextIsolation:true,sandbox:true,nodeIntegration:false}});win.loadFile(require('node:path').join(__dirname,'index.html'));});
app.on('window-all-closed',()=>app.quit());
`;
}

function ownedPath(root, file, directory = false) {
  const resolved = path.resolve(file);
  const relative = path.relative(root, resolved);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative))
    throw Error('Electron fixtures must belong to this temporary run');
  const stat = fs.lstatSync(resolved);
  if (
    stat.isSymbolicLink() ||
    (directory ? !stat.isDirectory() : !stat.isFile()) ||
    fs.realpathSync(resolved) !== resolved
  )
    throw Error('Redirected or invalid Electron fixture path');
  return resolved;
}

const hash = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function ownedProfileDestination(root, profile) {
  let current = path.resolve(profile);
  if (!current.startsWith(root + path.sep))
    throw Error('Electron profile must belong to this temporary run');
  for (;;) {
    try {
      const stat = fs.lstatSync(current);
      if (stat.isSymbolicLink() || !stat.isDirectory() || fs.realpathSync(current) !== current)
        throw Error('Redirected or invalid Electron profile');
      return;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      current = path.dirname(current);
    }
  }
}

export function verifySyntheticElectronPackage(executable, profile, policy) {
  const binary = ownedPath(policy.testRoot, executable);
  ownedPath(policy.testRoot, profile, true);
  const resources = path.join(path.dirname(binary), 'resources');
  if (
    fs.existsSync(path.join(resources, 'app.asar')) ||
    fs.existsSync(path.join(resources, 'app.asar.unpacked'))
  )
    throw Error(packagedGuiIsolationMessage);
  const app = ownedPath(policy.testRoot, path.join(resources, 'app'), true);
  const manifestFile = ownedPath(policy.testRoot, path.join(app, 'package.json'));
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  if (
    manifest.description !== 'Isolated NSIS test fixture' ||
    manifest.main !== 'main.cjs' ||
    manifest.private !== true ||
    !/^VoxCueUpdateTest-[a-f0-9]{8}$/.test(manifest.productName) ||
    manifest.name !== manifest.productName.toLowerCase() ||
    !/^\d+\.\d+\.\d+$/.test(manifest.version) ||
    Object.keys(manifest).some(
      (key) =>
        !['name', 'productName', 'version', 'main', 'description', 'author', 'private'].includes(
          key,
        ),
    )
  )
    throw Error('Unrecognized inert Electron fixture identity');
  if (
    fs.readFileSync(ownedPath(policy.testRoot, path.join(app, 'main.cjs')), 'utf8') !==
      syntheticElectronEntry(profile) ||
    fs.readFileSync(ownedPath(policy.testRoot, path.join(app, 'index.html')), 'utf8') !==
      syntheticElectronHtml ||
    hash(binary) !== hash(policy.defaultHost)
  )
    throw Error('Inert Electron fixture code or runtime identity changed');
}

/** No basename or fuse setting can authorize a product package on the owner. */
export function assertOwnerElectronLaunch(options, policy) {
  const executable = path.resolve(options.executablePath ?? policy.defaultHost);
  if ((options.env ?? process.env).ELECTRON_RUN_AS_NODE)
    throw Error('GUI fixtures cannot run in Node mode');
  const syntheticProfile = policy.syntheticPackages.get(executable);
  if (syntheticProfile) {
    verifySyntheticElectronPackage(executable, syntheticProfile, policy);
    if ((options.args ?? []).length)
      throw Error('Synthetic installation fixtures accept no entry override');
    return;
  }
  const host = policy.developmentHosts.find((value) => path.resolve(value.path) === executable);
  if (!host) throw Error(packagedGuiIsolationMessage);
  policy.verifyDevelopmentHost?.(host);
  const first = options.args?.[0];
  const ownedEntry =
    typeof first === 'string' &&
    !first.startsWith('-') &&
    path.resolve(first).startsWith(policy.testRoot + path.sep);
  const developmentRoot = first && path.resolve(first) === policy.platformRoot;
  const ownedProfile =
    typeof options.env?.COPILOT_TEST_USER_DATA === 'string' &&
    path.resolve(options.env.COPILOT_TEST_USER_DATA).startsWith(policy.testRoot + path.sep);
  if (options.env?.COPILOT_TEST_USER_DATA && !ownedProfile)
    throw Error('Electron profile must belong to this temporary run');
  if (ownedEntry) ownedPath(policy.testRoot, first, fs.lstatSync(first).isDirectory());
  if (ownedProfile) ownedProfileDestination(policy.testRoot, options.env.COPILOT_TEST_USER_DATA);
  if (!(ownedEntry || (ownedProfile && developmentRoot)))
    throw Error('Development Electron requires this run’s owned entry/profile');
}

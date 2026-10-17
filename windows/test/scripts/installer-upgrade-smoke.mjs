import { build, Platform, Arch } from 'electron-builder';
import electronExecutable from 'electron';
import { _electron as electron } from 'playwright';
import {
  mkdir,
  mkdtemp,
  writeFile,
  readFile,
  readdir,
  realpath,
  cp,
  rename,
} from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import config from '../../../windows/electron-builder.config.cjs';

await mkdir('test/results', { recursive: true });
const directory = await mkdtemp(path.resolve('test/results/nsis-upgrade-'));
const project = path.join(directory, 'fixture');
const target = path.join(directory, 'installed');
const profile = path.join(directory, 'profile');
const stage = path.join(directory, 'stage');
const name = 'VoxCueUpdateTest-' + randomUUID().slice(0, 8);
await mkdir(project);
await mkdir(profile);
await writeFile(
  path.join(project, 'main.cjs'),
  `
const {app,BrowserWindow,ipcMain}=require('electron');
app.setPath('userData',process.env.COPILOT_TEST_USER_DATA);
app.whenReady().then(()=>{const win=new BrowserWindow({show:false,webPreferences:{contextIsolation:true,sandbox:true,nodeIntegration:false}});win.loadFile(require('node:path').join(__dirname,'index.html'));});
app.on('window-all-closed',()=>app.quit());
`,
);
await writeFile(
  path.join(project, 'index.html'),
  '<!doctype html><meta charset="utf-8"><title>Isolated NSIS upgrade test</title><p>NSIS fixture</p>',
);
// Prepackaged fixture avoids collecting the parent workspace's native dependencies.
await cp(path.dirname(electronExecutable), stage, { recursive: true });
await rename(path.join(stage, 'electron.exe'), path.join(stage, name + '.exe'));
const testConfig = {
  ...config,
  appId: 'com.voxcue.updates-test.' + name,
  productName: name,
  directories: { output: path.join(directory, 'artifacts') },
  electronVersion: '38.8.6',
  compression: 'store',
  publish: null,
  win: {
    target: 'nsis',
    executableName: name,
    icon: path.resolve('public/voxcue.ico'),
    signAndEditExecutable: false,
  },
  nsis: {
    ...config.nsis,
    createDesktopShortcut: false,
    createStartMenuShortcut: false,
    runAfterFinish: false,
  },
};
const env = { ...process.env, COPILOT_TEST_USER_DATA: profile };
delete env.ELECTRON_RUN_AS_NODE;
const run = (executable, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(executable, args, { env, windowsHide: true, stdio: 'ignore' });
    child.once('error', reject);
    child.once('exit', (code) =>
      code === 0 ? resolve() : reject(Error('NSIS fixture failed: ' + code)),
    );
  });
let application;
let installed = false;
try {
  for (const version of ['0.1.0', '0.2.0']) {
    await writeFile(
      path.join(project, 'package.json'),
      JSON.stringify({
        name: name.toLowerCase(),
        productName: name,
        version,
        main: 'main.cjs',
        description: 'Isolated NSIS test fixture',
        author: 'VoxCue',
        private: true,
      }),
    );
    await cp(project, path.join(stage, 'resources/app'), { recursive: true });
    const artifacts = await build({
      projectDir: project,
      prepackaged: stage,
      config: testConfig,
      targets: Platform.WINDOWS.createTarget('nsis', Arch.x64),
      publish: 'never',
    });
    const installer = artifacts.find((file) => file.endsWith('.exe'));
    if (!installer || !path.resolve(installer).startsWith(directory + path.sep))
      throw Error('Unsafe test installer');
    await run(installer, ['/S', ...(version === '0.2.0' ? ['--updated'] : []), '/D=' + target]);
    installed = true;
    application = await electron.launch({
      executablePath: path.join(target, name + '.exe'),
      args: [],
      env,
    });
    const page = await application.firstWindow();
    await page.getByText('NSIS fixture', { exact: true }).waitFor();
    const actualVersion = await application.evaluate(({ app }) => app.getVersion());
    if (actualVersion !== version) throw Error('NSIS did not replace the expected version');
    if (version === '0.1.0') {
      await page.evaluate(async () => {
        localStorage.setItem('synthetic-profile', 'preserved profile');
        const db = await new Promise((resolve, reject) => {
          const request = indexedDB.open('synthetic-originals', 1);
          request.onupgradeneeded = () => request.result.createObjectStore('files');
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        await new Promise((resolve, reject) => {
          const transaction = db.transaction('files', 'readwrite');
          transaction.objectStore('files').put(new Blob(['original bytes']), 'document');
          transaction.oncomplete = resolve;
          transaction.onerror = reject;
        });
        db.close();
      });
      await writeFile(path.join(profile, 'synthetic-settings.json'), '{"preserve":true}');
    } else {
      const restored = await page.evaluate(async () => {
        const db = await new Promise((resolve, reject) => {
          const request = indexedDB.open('synthetic-originals', 1);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        const file = await new Promise((resolve, reject) => {
          const request = db.transaction('files').objectStore('files').get('document');
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        db.close();
        return { profile: localStorage.getItem('synthetic-profile'), bytes: await file.text() };
      });
      if (
        restored.profile !== 'preserved profile' ||
        restored.bytes !== 'original bytes' ||
        (await readFile(path.join(profile, 'synthetic-settings.json'), 'utf8')) !==
          '{"preserve":true}'
      )
        throw Error('NSIS upgrade lost test data');
    }
    await application.close();
    application = undefined;
  }
  await writeFile(
    path.join(directory, 'report.json'),
    JSON.stringify(
      {
        passed: true,
        realNsisInstall: true,
        upgrade: '0.1.0 -> 0.2.0',
        localStoragePreserved: true,
        indexedDbOriginalBytesPreserved: true,
        filesPreserved: true,
        syntheticFixture: true,
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ passed: true, directory }));
} finally {
  if (application) await application.close();
  if (installed) {
    const actual = await realpath(target);
    if (!actual.startsWith(directory + path.sep)) throw Error('Unsafe test installation cleanup');
    const uninstaller = (await readdir(target)).find(
      (file) => file.startsWith('Uninstall ') && file.endsWith('.exe'),
    );
    if (uninstaller) await run(path.join(target, uninstaller), ['/S']);
  }
}

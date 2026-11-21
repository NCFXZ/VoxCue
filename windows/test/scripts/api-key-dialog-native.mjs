import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdtemp, writeFile, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { electron, testRoot } from '../../../shared/test/scripts/test-workspace.mjs';
import { offlineElectronEntry } from '../../../shared/test/scripts/offline-electron-entry.mjs';
import { closeUiApp, enterPrimaryUiAccount, focusUiWindow, installUiAccount } from '../../../shared/test/scripts/install-ui-account.mjs';
import { watchTestDesktop } from '../../../shared/test/scripts/desktop-guard.mjs';
import { probe, stableTarget } from './window-probe.mjs';

assert.equal(process.platform, 'win32');
const options = process.argv.slice(2);
const zoomOption = options.find(value => /^--zoom=(1|1\.25|1\.5|1\.75|2)$/.test(value));
const deliver = options.includes('--export-masked');
assert.ok(options.every(value => value === zoomOption || value === '--export-masked'), 'Use --zoom=1|1.25|1.5|1.75|2 and optionally --export-masked');
const zooms = zoomOption ? [Number(zoomOption.slice(7))] : [1, 1.25];
const root = fileURLToPath(new URL('../../', import.meta.url));
const privateImage = path.join(testRoot, 'api-key-dialog-masked.png');
const executable = path.join(testRoot, 'ApiKeyDialogProbe.exe');
const framework = path.join(process.env.WINDIR, 'Microsoft.NET/Framework64/v4.0.30319');
const manifest = path.join(process.env.WINDIR, 'System32/WinMetadata');
const csc = spawnSync(path.join(framework, 'csc.exe'), [
  '/nologo', '/utf8output', '/codepage:65001', '/platform:x64', '/r:System.Drawing.dll',
  '/r:System.Runtime.dll', '/r:System.Runtime.WindowsRuntime.dll', '/r:System.Runtime.InteropServices.WindowsRuntime.dll',
  ...['Foundation','Graphics','Storage'].map(name => '/r:' + path.join(manifest, 'Windows.' + name + '.winmd')),
  '/out:' + executable, fileURLToPath(new URL('../fixtures/ApiKeyDialogProbe.cs', import.meta.url)),
], { encoding: 'utf8', windowsHide: true });
assert.equal(csc.status, 0, csc.stderr + csc.stdout);
const unlocked = () => assert.equal(probe('desktop').interactive, true, 'Unlocked owner console required');
const ownerProfile = path.join(testRoot, 'native-key-profile');
const fixture = path.join(testRoot, 'api-key-dialog.cjs');
const fixtureCode = `
const path=require('node:path'), fs=require('node:fs'), {app}=require('electron');
const profile=${JSON.stringify(ownerProfile)}, root=${JSON.stringify(root)};
if (process.platform!=='win32' || app.isPackaged || app.getPath('userData')!==profile ||
    !fs.existsSync(path.join(path.dirname(profile),'.voxcue-test-owner.json'))) throw Error('Isolated development host required');
const load=name=>require(path.join(root,'dist-electron/shared/electron',name+'.js'));
const unavailable=async()=>{throw Error('Synthetic key dialog does not use a subscription');};
Object.assign(load('backend/copilot/auth').CopilotAuthService.prototype,{
  session:async()=>null,verifiedSession:async()=>null,signIn:unavailable
});
Object.assign(load('backend/copilot/runtime').CopilotRuntime.prototype,{control:unavailable,client:unavailable});
const {ApiCredentialStore}=load('backend/api/credentials');
let saved=false;globalThis.nativeKeySaves=0;
Object.assign(ApiCredentialStore.prototype,{
  async list(){return saved?[{provider:'openai'}]:[];},async read(){return null;},
  async save(provider,credential){
    if(provider!=='openai' || credential.key!=='Wivi8g')throw Error('Synthetic key did not round-trip');
    saved=true;globalThis.nativeKeySaves++;
  },async remove(){saved=false;},async dispose(){}
});
const services=load('backend/api/service'), original=services.createApiChatService;
const transport=require(${JSON.stringify(fileURLToPath(new URL('../../../shared/test/fixtures/api-interactive-preview.cjs', import.meta.url)))}).transport;
services.createApiChatService=(provider,access,ledger)=>original(provider,access,ledger,transport(provider,'Wivi8g'));
// Ordinary temporary-profile GUI runs intentionally refuse the native credential
// editor. Bind only this verified test window and the one synthetic provider.
const keyPorts=require(path.join(root,'dist-electron/windows/electron/apiKeyPrompt.js'));
const ipc=load('ipc/apiConnections'), register=ipc.registerApiConnectionIpc;
function owner(){
  const win=require('electron').BrowserWindow.fromId(globalThis.nativeKeyOwnerId);
  if(!win || win.isDestroyed() || !win.isVisible())throw Error('Owned key dialog required');
  return win;
}
ipc.registerApiConnectionIpc=ports=>register({...ports,
  prompt(provider,signal,field,tab){
    if(provider!=='openai')throw Error('Unexpected synthetic provider');
    return keyPorts.promptApiKey(owner(),'OpenAI API','zh-CN',signal,field,tab);
  },
  control(command){return keyPorts.controlApiKey(owner(),command);}
});
const cp=require('node:child_process'), spawn=cp.spawn;
const expected=fs.realpathSync(path.join(root,'native/bin/VoxCue.ApiKeyPrompt.exe'));
cp.spawn=function(file,args,...options){
  const key=path.basename(String(file)).toLowerCase()==='voxcue.apikeyprompt.exe';
  if(key && (fs.realpathSync(file)!==expected || Number(args[1])!==process.pid))throw Error('Unexpected native helper');
  const child=spawn.call(this,file,args,...options);
  if(key){globalThis.nativeKeyHelper=child.pid;child.once('close',()=>{if(globalThis.nativeKeyHelper===child.pid)globalThis.nativeKeyHelper=0;});}
  return child;
};
require(path.join(root,'dist-electron/shared/electron/main.js'));
`;
await writeFile(fixture, fixtureCode);
unlocked();
const cursor = probe('cursor');
let lastClick;
let exported = false;
const app = await electron.launch({
  args: [await offlineElectronEntry(fixture)],
  env: { ...process.env, COPILOT_TEST_USER_DATA: ownerProfile, VOXCUE_ACCOUNT_API: '', VITE_DEV_SERVER_URL: '' },
});
const guard = watchTestDesktop(app.process(), unlocked);
try {
  await installUiAccount(app);
  const login = await app.firstWindow();
  const page = await enterPrimaryUiAccount(app, login);
  page.setDefaultTimeout(8000);
  await focusUiWindow(app, page);
  const win = await app.browserWindow(page);
  const owner = await win.evaluate(w => ({ id:w.id, handle:w.getNativeWindowHandle().readBigUInt64LE().toString(), pid:process.pid }));
  await app.evaluate((_,id)=>{globalThis.nativeKeyOwnerId=id;},owner.id);
  const settings = page.getByRole('dialog', { name: '设置', exact: true });
  const prompt = page.getByRole('dialog', { name: '添加 API 密钥', exact: true });
  const button = (scope, name) => scope.getByRole('button', { name, exact: true });
  async function projection(box) {
    const geometry = probe('geometry', owner.handle, owner.pid);
    const view = await page.evaluate(() => ({ w:innerWidth, h:innerHeight }));
    const x = geometry.clientWidth / view.w, y = geometry.clientHeight / view.h;
    return {
      left:Math.round(box.x*x), top:Math.round(box.y*y),
      right:Math.round((box.x+box.width)*x), bottom:Math.round((box.y+box.height)*y),
      x:geometry.clientX+Math.round((box.x+box.width/2)*x), y:geometry.clientY+Math.round((box.y+box.height/2)*y),
    };
  }
  async function physicalClick(locator) {
    const p = await stableTarget(locator, projection);
    unlocked();
    assert.equal(probe('foreground').handle, owner.handle);
    probe('click', owner.handle, p.x, p.y);
    lastClick = {x:p.x,y:p.y};
  }
  async function helperPid() {
    const deadline=Date.now()+5000;
    do {
      const pid=await app.evaluate(() => globalThis.nativeKeyHelper);
      if(Number.isSafeInteger(pid) && pid>0)return pid;
      await new Promise(resolve=>setTimeout(resolve,40));
    } while(Date.now()<deadline);
    throw Error('The development app did not launch the production key editor');
  }
  let saves=0;
  await button(page,'用户菜单').click();
  await page.getByRole('menuitem',{name:'设置',exact:true}).click();
  for (const zoom of zooms) {
    await win.evaluate((w,z) => w.webContents.setZoomFactor(z), zoom);
    for (const theme of ['light','dark']) {
      const nav=settings.getByRole('navigation',{name:'设置分类'});
      await button(nav,'通用').click();
      await button(settings,'外观主题').click();
      await page.getByRole('menuitemradio',{name:theme==='light'?'浅色':'深色',exact:true}).click();
      await button(nav,'AI 服务').click();
      await settings.getByRole('radio',{name:'API 密钥',exact:true}).click();
      const service=settings.getByRole('group',{name:'OpenAI API',exact:true});
      if(saves) {
        await service.getByRole('button',{name:/^移除密钥/}).click();
        await service.getByRole('button',{name:/^确认/}).click();
      }
      await focusUiWindow(app,page);
      await physicalClick(button(service,'添加密钥'));
      await prompt.waitFor();
      const slot=prompt.locator('[data-api-key-field]');
      assert.equal(await slot.locator('input,textarea,[contenteditable=true]').count(),0);
      const pid=await helperPid();
      async function native(op, output) {
        const p=await stableTarget(prompt,projection);
        const target=await projection(await slot.boundingBox());
        const args=[owner.handle,owner.pid,pid,op,theme,p.left,p.top,p.right-p.left,p.bottom-p.top,target.x,target.y];
        if(output)args.push(output);
        unlocked();
        const result=spawnSync(executable,args.map(String),{encoding:'utf8',windowsHide:true,timeout:10000});
        assert.equal(result.status,0,`${op} ${theme} zoom=${zoom} ${result.stderr || result.error || ''}`);
      }
      await native('empty');
      if(theme==='dark') await physicalClick(slot);
      await native('type');
      await native('masked');
      await physicalClick(button(prompt,'显示密钥'));
      await button(prompt,'隐藏密钥').waitFor();
      await native('revealed');
      await physicalClick(button(prompt,'隐藏密钥'));
      await button(prompt,'显示密钥').waitFor();
      const output=deliver && !exported ? privateImage : undefined;
      await native('masked',output);
      exported ||= !!output;
      await physicalClick(button(prompt,'验证并保存'));
      await prompt.waitFor({state:'hidden'});
      assert.equal(await app.evaluate(()=>globalThis.nativeKeySaves),++saves,'Exact synthetic input reaches the isolated main-process store');
      const dpr=await page.evaluate(()=>devicePixelRatio);
      console.log('PASS native Electron key dialog', {theme,zoom,dpr});
    }
  }
  await win.dispose();
  if (guard.failure) throw guard.failure;
} finally {
  guard.release();
  await closeUiApp(app);
  if(lastClick && probe('desktop').interactive) {
    const at=probe('cursor-activity');
    if(!at.buttonDown && at.x===lastClick.x && at.y===lastClick.y)
      probe('move',cursor.x,cursor.y,'if-quiet',at.x,at.y,at.inputTick);
  }
}
if(exported) {
  const folder=await mkdtemp(path.join(await realpath(os.tmpdir()),'voxcue-masked-dialog-'));
  const file=path.join(folder,'api-key-dialog-masked.png');
  await copyFile(privateImage,file);
  console.log('Masked native dialog PNG',file);
}

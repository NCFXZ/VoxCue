import { testRoot, spawnTestProcess } from '../../../shared/test/scripts/test-workspace.mjs';
import workspace from '../../../shared/scripts/workspace.mjs';
import { loadDevelopmentSigning, signLocalCode } from '../../scripts/development-signing.mjs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';

// Exercise the unchanged JS encryption port + cloud vault in signed Electron,
// using the existing test-only native source's explicit temporary Keychain.
// The canonical production helper is never launched or modified.
assert.equal(process.platform, 'darwin');
const signing = await loadDevelopmentSigning();
const canonical = path.join(
  workspace.platformRoot,
  '.tools/credential-helper-v1/VoxCue.Credentials',
);
const before = createHash('sha256')
  .update(await readFile(canonical))
  .digest('hex');
const run = (command, args) => {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 30000 });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
};
const keychainList = () => run('/usr/bin/security', ['list-keychains', '-d', 'user']);
const previousList = keychainList();
const keychain = path.join(testRoot, 'synthetic.keychain-db');
const managerSource = path.join(testRoot, 'keychain.mm');
await writeFile(
  managerSource,
  `#import <Foundation/Foundation.h>
#import <Security/Security.h>
int main(int argc,const char **argv){@autoreleasepool{
 if(argc!=3)return 64;SecKeychainSetUserInteractionAllowed(false);
 const char *password="synthetic-cloud-keychain-password";SecKeychainRef keychain=NULL;
 OSStatus status;
 if(strcmp(argv[1],"create")==0)status=SecKeychainCreate(argv[2],(UInt32)strlen(password),password,false,NULL,&keychain);
 else{status=SecKeychainOpen(argv[2],&keychain);if(status==noErr){
  if(strcmp(argv[1],"lock")==0)status=SecKeychainLock(keychain);
  else if(strcmp(argv[1],"unlock")==0)status=SecKeychainUnlock(keychain,(UInt32)strlen(password),password,true);
  else if(strcmp(argv[1],"delete")==0)status=SecKeychainDelete(keychain);
  else status=errSecParam;
 }}if(keychain)CFRelease(keychain);if(status!=noErr)fprintf(stderr,"OSStatus %d",(int)status);return status==noErr?0:1;
}}`,
);
const compile = (source, output) => {
  run('/usr/bin/xcrun', [
    'clang++',
    '-std=c++17',
    '-fobjc-arc',
    '-Wno-deprecated-declarations',
    '-mmacosx-version-min=14.2',
    '-O2',
    '-DVOXCUE_SIGNING_SHA1="' + signing.sha1.toLowerCase() + '"',
    source,
    '-framework',
    'Foundation',
    '-framework',
    'Security',
    '-o',
    output,
  ]);
  signLocalCode(output, signing, 'com.voxcue.credentials', { preserveMetadata: false });
};
const manager = path.join(testRoot, 'keychain-manager');
const helper = path.join(testRoot, 'credential-probe');
compile(managerSource, manager);
compile(path.join(workspace.platformRoot, 'test/fixtures/credential-probe.mm'), helper);
const profile = path.join(testRoot, 'profile');
await mkdir(profile);
run(manager, ['create', keychain]);
try {
  for (const phase of ['write', 'read']) {
    const entry = path.join(testRoot, phase + '.cjs');
    await writeFile(
      entry,
      `
const {app}=require('electron');const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs/promises');
const deny=()=>{throw Error('Native vault fixture forbids network')};globalThis.fetch=deny;require('electron').net.fetch=deny;for(const name of ['node:http','node:https']){require(name).request=deny;require(name).get=deny}require('node:net').Socket.prototype.connect=deny;require('node:tls').connect=deny;
const root=${JSON.stringify(workspace.platformRoot)},helper=${JSON.stringify(helper)},keychain=${JSON.stringify(keychain)},manager=${JSON.stringify(manager)};
app.setAppPath(root);app.setPath('userData',${JSON.stringify(profile)});app.commandLine.appendSwitch('use-mock-keychain');
const cp=require('node:child_process'),spawn=cp.spawn;let nativeCalls=0;
cp.spawn=function(executable,args,options){
 if(String(executable).endsWith('/VoxCue.Credentials'))throw Error('Production helper forbidden in this fixture');
 if(executable===helper){assert.deepEqual(args,[]);nativeCalls++;return spawn.call(this,helper,[keychain],options);}
 return spawn.call(this,executable,args,options);
};
app.whenReady().then(async()=>{
 assert.equal(process.versions.electron,'44.10.0');
 const {createCredentialEncryption}=require(root+'/dist-electron/macos/electron/credentials.js');
 const {createCloudVault}=require(root+'/dist-electron/shared/electron/backend/cloud/vault.js');
 const {CloudAccountClient}=require(root+'/dist-electron/shared/electron/backend/cloud/client.js');
 const vault=createCloudVault(createCredentialEncryption(helper)),file=path.join(app.getPath('userData'),'cloud-account/session.bin');
 const user={id:'11111111-1111-4111-8111-111111111111',email:'native@example.test',createdAt:1};
 const credentials={user,sessionId:'22222222-2222-4222-8222-222222222222',accessToken:'a'.repeat(43),refreshToken:'b'.repeat(43),expiresAt:Date.now()+900000,refreshExpiresAt:Date.now()+86400000};
 const phase=${JSON.stringify(phase)},revoked=[];
 const fetcher=async(url,options)=>{if(String(url).endsWith('/logout'))revoked.push(new Headers(options.headers).get('authorization'));return new Response(JSON.stringify(String(url).endsWith('/account')?{user}:String(url).endsWith('/logout')?{}:phase==='write'?credentials:{...credentials,sessionId:'33333333-3333-4333-8333-333333333333',accessToken:'c'.repeat(43),refreshToken:'d'.repeat(43)}),{status:200});};
 const client=new CloudAccountClient({origin:'https://native.example.test',vault,deviceLabel:'Synthetic Mac',fetcher});
 const result=await client.call(phase==='write'?{action:'login',email:user.email,password:'legacy'}:{action:'status'});
 assert.equal(result.ok,true,result.error);assert.deepEqual(result.state.user,user);
 const original=await fs.readFile(file);assert.equal(original.subarray(0,3).toString(),'v10');assert.ok(!original.includes(Buffer.from(user.email)));assert.ok(!original.includes(Buffer.from(credentials.accessToken)));assert.equal((await fs.stat(file)).mode&0o777,0o600);
 assert.deepEqual((await vault.read()).credentials.user,user);assert.ok(nativeCalls>=2);
 if(phase==='read'){
  const operate=mode=>{const r=cp.spawnSync(manager,[mode,keychain],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);};
  operate('lock');try{
   const failed=await client.call({action:'login',email:user.email,password:'legacy'});assert.equal(failed.ok,false);assert.match(failed.error,/无法安全保存/);assert.deepEqual(revoked,['Bearer '+'c'.repeat(43)]);assert.deepEqual(await fs.readFile(file),original);
  }finally{operate('unlock');}
  assert.deepEqual((await vault.read()).credentials.user,user);
 }
 console.log('PASS: native cloud vault '+phase+', real v10/0600, signed Electron44 JS port; isolated Keychain only'+(phase==='read'?', restart decryption and locked-keychain rollback/revocation':''));app.exit(0);
}).catch(error=>{console.error(error);app.exit(1)});
`,
    );
    const child = spawnTestProcess(workspace.platformRequire('electron'), [entry], {
      cwd: workspace.platformRoot,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
      stdio: 'inherit',
    });
    const timer = setTimeout(() => child.kill('SIGTERM'), 60000);
    const code = await new Promise((resolve, reject) => {
      child.once('exit', resolve);
      child.once('error', reject);
    }).finally(() => clearTimeout(timer));
    assert.equal(code, 0, phase);
  }
} finally {
  run(manager, ['delete', keychain]);
}
assert.equal(keychainList(), previousList);
assert.equal(
  createHash('sha256')
    .update(await readFile(canonical))
    .digest('hex'),
  before,
);
console.log(
  'PASS: temporary Keychain deleted, search list unchanged, canonical helper bytes unchanged; no real login Keychain access.',
);

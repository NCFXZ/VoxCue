import { testRoot, spawnTestProcess } from '../../../shared/test/scripts/test-workspace.mjs';
import workspace from '../../../shared/scripts/workspace.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

// Run the unchanged Python worker and its real owner-reader thread. Only model
// computation is synthetic, so this can hold an operation without a GPU/model.
const models = path.join(testRoot, 'synthetic-model');
await mkdir(models);
for (const name of ['config.json', 'model.safetensors'])
  await writeFile(path.join(models, name), '{}');
const entry = path.join(testRoot, 'held-python.py');
await writeFile(
  entry,
  `import sys,types,runpy,time
mx=types.ModuleType('mlx.core');mx.bfloat16='bfloat16';mx.eval=lambda value:None
mlx=types.ModuleType('mlx');mlx.core=mx
sys.modules.update({'mlx':mlx,'mlx.core':mx})
model=types.SimpleNamespace(parameters=lambda:[],model=types.SimpleNamespace(embed_tokens=types.SimpleNamespace(weight=types.SimpleNamespace(dtype='bfloat16'))))
loader=types.ModuleType('mlx_qwen3_asr.load_models');loader.load_model=lambda *args,**kwargs:(model,{})
streaming=types.ModuleType('mlx_qwen3_asr.streaming')
streaming.init_streaming=lambda **kwargs:types.SimpleNamespace(text='synthetic')
def held(*args,**kwargs):
 print('SYNTHETIC_COMPUTE_ENTERED',flush=True);time.sleep(60)
streaming.feed_audio=held
package=types.ModuleType('mlx_qwen3_asr');package.streaming=streaming
sys.modules.update({'mlx_qwen3_asr':package,'mlx_qwen3_asr.load_models':loader,'mlx_qwen3_asr.streaming':streaming})
sys.argv=[${JSON.stringify(path.join(workspace.platformRoot, 'native/qwen-mlx.py'))},${JSON.stringify(models)}]
runpy.run_path(sys.argv[0],run_name='__main__')
`,
);
const parent = path.join(testRoot, 'synthetic-owner.cjs');
await writeFile(
  parent,
  `const {spawn}=require('node:child_process'),{createInterface}=require('node:readline');
const child=spawn(${JSON.stringify(path.join(workspace.platformRoot, 'native/bin/qwen/python/bin/python3.12'))},['-I','-B',${JSON.stringify(entry)}],{env:{PATH:'/usr/bin:/bin'},stdio:['pipe','pipe','pipe']});
child.stderr.pipe(process.stderr);
createInterface({input:child.stdout}).on('line',line=>{
 if(line==='SYNTHETIC_COMPUTE_ENTERED'){console.log(JSON.stringify({pid:child.pid,busy:true}));return;}
 const value=JSON.parse(line);
 if(value.type==='ready')child.stdin.write(JSON.stringify({op:'start',seq:1,source:'system',chunk:8000,audio:''})+'\\n');
 else if(value.type==='ack'&&value.seq===1)child.stdin.write(JSON.stringify({op:'feed',seq:2,source:'system',audio:''})+'\\n');
});
`,
);
const controller = spawnTestProcess(process.execPath, [parent], {
  stdio: ['ignore', 'pipe', 'inherit'],
});
let python;
try {
  const ready = await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(Error('Synthetic Python computation did not start')),
      10000,
    );
    let output = '';
    controller.stdout.on('data', (data) => {
      output += data;
      if (!output.includes('\n')) return;
      try {
        const value = JSON.parse(output.trim());
        if (value.busy) {
          clearTimeout(timer);
          resolve(value);
        }
      } catch (error) {
        clearTimeout(timer);
        reject(error);
      }
    });
    controller.once('exit', () => {
      clearTimeout(timer);
      reject(Error('Synthetic owner exited early'));
    });
  });
  python = ready.pid;
  assert.ok(Number.isSafeInteger(python) && python > 0);
  const closed = new Promise((resolve) => controller.once('close', resolve));
  controller.kill('SIGKILL');
  await closed;
  for (let i = 0; i < 100; i++) {
    try {
      process.kill(python, 0);
    } catch (error) {
      if (error.code === 'ESRCH') {
        python = undefined;
        break;
      }
      throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.equal(
    python,
    undefined,
    'Real Python must exit on owner EOF even during a held computation',
  );
  console.log(
    'PASS: actual Python owner-reader exits after the synthetic parent disappears during computation; no GPU, model, audio capture or network.',
  );
} finally {
  controller.kill('SIGKILL');
  if (python) {
    try {
      process.kill(python, 'SIGKILL');
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
  }
}

import { readFile, mkdir, rename, access } from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
const manifest = JSON.parse(await readFile(new URL('./rag-model.json', import.meta.url), 'utf8'));
const root = path.resolve('local-models/rag/multilingual-e5-small');
const digest = async (file) => {
  const h = createHash('sha256');
  for await (const data of createReadStream(file)) h.update(data);
  return h.digest('hex');
};
console.log(
  '将下载公开 multilingual-e5-small q8 模型（约 129 MiB）；文档不会发送到网络。下载后运行完全离线。',
);
for (const [name, expected] of Object.entries(manifest.files)) {
  const file = path.join(root, name);
  await mkdir(path.dirname(file), { recursive: true });
  let exists = true;
  try {
    await access(file);
  } catch {
    exists = false;
  }
  if (exists) {
    if ((await digest(file)) !== expected)
      throw Error('已有模型文件校验失败，已保留，请先备份后人工处理：' + name);
    continue;
  }
  console.log('下载：' + name);
  const response = await fetch(
    `https://huggingface.co/${manifest.modelId}/resolve/${manifest.revision}/${name}`,
  );
  if (!response.ok) throw Error('模型下载失败：HTTP ' + response.status);
  await pipeline(Readable.fromWeb(response.body), createWriteStream(file + '.partial'));
  if ((await digest(file + '.partial')) !== expected)
    throw Error('模型 SHA256 不匹配，未启用该文件。');
  await rename(file + '.partial', file);
}
console.log('本地 RAG 模型已校验，可以离线加载。');

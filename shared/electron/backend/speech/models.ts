import { openSync, readSync, closeSync, existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
export const paraformerFiles = [
  'encoder.int8.onnx',
  'decoder.int8.onnx',
  'tokens.txt',
  'silero_vad.onnx',
];
export function speechModelInstalled(directory: string) {
  return ['manifest.json', ...paraformerFiles].every((file) =>
    existsSync(path.join(directory, file)),
  );
}
export function verifyModel(directory: string, files: string[], label: string) {
  let manifest: { files: Record<string, { sha256: string }> };
  try {
    manifest = JSON.parse(readFileSync(path.join(directory, 'manifest.json'), 'utf8'));
  } catch {
    throw Error(`${label} 模型未安装，请先下载语音模型。`);
  }
  const block = Buffer.allocUnsafe(512 * 1024);
  for (const name of files) {
    let file: number | undefined;
    try {
      file = openSync(path.join(directory, name), 'r');
      const hash = createHash('sha256');
      let length;
      while ((length = readSync(file, block, 0, block.length, null)) > 0)
        hash.update(block.subarray(0, length));
      if (hash.digest('hex') !== manifest.files[name]?.sha256) throw Error();
    } catch {
      throw Error(`${label} 语音模型校验失败，请重新下载。`);
    } finally {
      if (file !== undefined) closeSync(file);
    }
  }
}

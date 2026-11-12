import type { ComponentId } from '../../contracts/components';
import { qwenPackage } from './qwen-catalog';
import { qwenInt8Aligner } from './qwen-int8-catalog';
import { qwenWindowsRuntime } from './qwen-windows-runtime-catalog';
import { createHash } from 'node:crypto';

export interface ComponentArchive {
  tag: string;
  asset: string;
  bytes: number;
  sha256: string;
  files: { path: string; bytes: number; sha256: string; mode: number }[];
}
export interface ComponentPackage extends ComponentArchive {
  optional?: boolean;
  id: ComponentId;
  target: string;
  label: string;
  version: string;
  tag: string;
  asset: string;
  bytes: number;
  sha256: string;
  directory: string;
  files: { path: string; bytes: number; sha256: string; mode: number }[];
  parts?: ComponentArchive[];
  previous?: { package: ComponentPackage; preserve?: true }[];
}

// Fixed trust roots from the independently published resources. Never accept a renderer URL or remote catalog.
export const componentPackages: ComponentPackage[] = [
  {
    id: 'speech',
    target: 'all',
    label: '本地语音模型',
    version: '1.0.0',
    tag: 'models-v1.0.0',
    asset: 'VoxCue-Models-Speech-1.0.0.zip',
    bytes: 219148062,
    sha256: '8c6d16a76f4e442986385f24a63492aa5f0ea7add3de06f83db0d746467700e6',
    directory: 'speech',
    files: [
      {
        path: 'speech/LICENSE-sherpa.txt',
        bytes: 11358,
        sha256: 'cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30',
        mode: 420,
      },
      {
        path: 'speech/LICENSE-silero.txt',
        bytes: 1075,
        sha256: '2e63e9a38b6e8fc0c7bc37ce174caca1862870856c6daf5697cfb785e925520b',
        mode: 420,
      },
      {
        path: 'speech/NOTICE.txt',
        bytes: 775,
        sha256: 'dc8681d6f18ab14313e0a8f7b9e1278bd7a13d13c018bac4a51287df6e7369bf',
        mode: 420,
      },
      {
        path: 'speech/README.md',
        bytes: 415,
        sha256: '16b56210f03531d00f5580b060ff6843461e618e5642c070a58df6f0a5c98875',
        mode: 420,
      },
      {
        path: 'speech/decoder.int8.onnx',
        bytes: 71664561,
        sha256: 'f3cca9f77bb9d93c8fcbfb63ae617b6b1ee96818df3aa3b151c40658fe38594f',
        mode: 420,
      },
      {
        path: 'speech/encoder.int8.onnx',
        bytes: 165462184,
        sha256: '81a70226a8934e6ed92aa1d4fc486b428b5398e2f2619ed4897b7294cab90e9a',
        mode: 420,
      },
      {
        path: 'speech/manifest.json',
        bytes: 2198,
        sha256: '3c7f6b06a758087c6d97425d847756f5d4f8f312626ea4a1bfebbe17b4f7f9b1',
        mode: 420,
      },
      {
        path: 'speech/silero_vad.onnx',
        bytes: 643854,
        sha256: '9e2449e1087496d8d4caba907f23e0bd3f78d91fa552479bb9c23ac09cbb1fd6',
        mode: 420,
      },
      {
        path: 'speech/tokens.txt',
        bytes: 75756,
        sha256: '59aba8873a2ed1e122c25fee421e25f283b63290efbde85c1f01a853d83cb6e6',
        mode: 420,
      },
    ],
  },
  {
    id: 'rag',
    target: 'all',
    label: '知识库模型',
    version: '1.0.0',
    tag: 'models-v1.0.0',
    asset: 'VoxCue-Models-RAG-1.0.0.zip',
    bytes: 84970314,
    sha256: '3f83214d4748dd79294ac60827524556062904273a50f418c7839663c9be6069',
    directory: 'rag/multilingual-e5-small',
    files: [
      {
        path: 'rag/multilingual-e5-small/LICENSE-e5.txt',
        bytes: 1104,
        sha256: '904dc4d8749877f1dba1cda48200d2462dccbeb7c134d5e4ef6fa75e0198c8fe',
        mode: 420,
      },
      {
        path: 'rag/multilingual-e5-small/README-upstream.md',
        bytes: 1077,
        sha256: '561a19594636657fe033f8b4427a7743b5f6f3a12f16cecc5f286feca0453245',
        mode: 420,
      },
      {
        path: 'rag/multilingual-e5-small/SOURCE.json',
        bytes: 683,
        sha256: 'bb438b6fd84313d305202e842f709e80dd1ec3705ae6e4c598e7d0e944789eaf',
        mode: 420,
      },
      {
        path: 'rag/multilingual-e5-small/config.json',
        bytes: 658,
        sha256: 'cb99455288675345e1a4f411438d5d0adbba5fbd3a67ea4fb03c015433b996c1',
        mode: 420,
      },
      {
        path: 'rag/multilingual-e5-small/onnx/model_quantized.onnx',
        bytes: 118308185,
        sha256: 'f80102d3f2a1229f387d3c81909990d8945513e347b0eab049f7de3c6f98c193',
        mode: 420,
      },
      {
        path: 'rag/multilingual-e5-small/special_tokens_map.json',
        bytes: 167,
        sha256: 'd05497f1da52c5e09554c0cd874037a083e1dc1b9cfd48034d1c717f1afc07a7',
        mode: 420,
      },
      {
        path: 'rag/multilingual-e5-small/tokenizer.json',
        bytes: 17082730,
        sha256: '0b44a9d7b51c3c62626640cda0e2c2f70fdacdc25bbbd68038369d14ebdf4c39',
        mode: 420,
      },
      {
        path: 'rag/multilingual-e5-small/tokenizer_config.json',
        bytes: 443,
        sha256: 'a1d6bc8734a6f635dc158508bef000f8e2e5a759c7d92f984b2c86e5ff53425b',
        mode: 420,
      },
    ],
  },
  qwenPackage,
];

export function packagesFor(platform: string, arch: string) {
  const target =
    platform === 'darwin' && arch === 'arm64'
      ? 'macos-arm64'
      : platform === 'win32' && arch === 'x64'
        ? 'windows-x64'
        : undefined;
  if (!target) throw Error('当前平台不支持本地组件下载。');
  const packages = componentPackages.filter(
    (p) => p.id !== 'qwen' && (p.target === 'all' || p.target === target),
  );
  // Both platforms retain original BF16 ASR and use the fixed Q8_0 aligner.
  // Mac bundles its signed runtime; Windows downloads its own verified archive.
  // Keep qwenPackage's original 1.0.0 descriptors as historical trust roots.
  const parts = [
    qwenPackage.parts![0],
    qwenInt8Aligner,
    ...(target === 'windows-x64' ? [qwenWindowsRuntime] : []),
  ];
  packages.push({
    ...qwenPackage,
    target,
    version: '1.0.1',
    previous: [{ package: qwenPackage, preserve: true }],
    parts,
    files: parts.flatMap((part) => part.files),
    bytes: parts.reduce((sum, part) => sum + part.bytes, 0),
    sha256: createHash('sha256')
      .update(parts.map((part) => part.sha256).join('\n'))
      .digest('hex'),
  });
  return packages;
}

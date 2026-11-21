import { createHash } from 'node:crypto';

export const sileroModel = {
  name: 'silero_vad.onnx',
  bytes: 643854,
  sha256: '9e2449e1087496d8d4caba907f23e0bd3f78d91fa552479bb9c23ac09cbb1fd6',
  url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx',
};
export const sileroLicense = {
  name: 'LICENSE-silero.txt',
  bytes: 1075,
  sha256: '2e63e9a38b6e8fc0c7bc37ce174caca1862870856c6daf5697cfb785e925520b',
  url: 'https://raw.githubusercontent.com/snakers4/silero-vad/master/LICENSE',
};
export function validSileroAsset(asset, bytes) {
  return bytes.length === asset.bytes && createHash('sha256').update(bytes).digest('hex') === asset.sha256;
}

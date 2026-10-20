"""Package the pinned Q8_0 aligner as a new asset; never overwrite old resources."""
import argparse
import hashlib
import json
import pathlib
import shutil
import zipfile

SOURCE = {
    'repository': 'cstr/qwen3-forced-aligner-0.6b-GGUF',
    'revision': '1ec5110602ccab18c878ddebedab0891e290a95c',
    'filename': 'qwen3-forced-aligner-0.6b-q8_0.gguf',
    'bytes': 985594624,
    'sha256': '539df5dd0fe1721e378ac13bfac9a26b1260dafb62d892c518c1f21244762636',
    'upstream': 'Qwen/Qwen3-ForcedAligner-0.6B',
    'upstreamRevision': 'c7cbfc2048c462b0d63a45797104fc9db3ad62b7',
    'license': 'Apache-2.0',
    'format': 'GGUF v3 / GGML Q8_0',
    'changes': 'Model file is byte-identical to source. Original tokenizer/config retained. No retraining or requantization.',
    'loading': 'Shared Rust loader dequantizes each tensor at load time to the existing CPU/CUDA compute precision. Disk/download shrinkage does not imply halved resident memory.',
}
METADATA = {
    'config.json': 'd616c65d46c4b90bdc651b0a0963ea932732241140f337f9bb6b0335a9c8ef09',
    'merges.txt': '8831e4f1a044471340f7c0a83d7bd71306a5b867e95fd870f74d0c5308a904d5',
    'tokenizer_config.json': '3ab80063f8511deb9566e6ad438d17b7a6277fcffd52d92854112f19d36bd81c',
    'vocab.json': 'ca10d7e9fb3ed18575dd1e277a2579c16d108e32f27439684afa0e10b1440910',
}


def digest(path):
    with path.open('rb') as file:
        return hashlib.file_digest(file, 'sha256').hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('stage', type=pathlib.Path)
    parser.add_argument('output', type=pathlib.Path)
    parser.add_argument('--catalog', type=pathlib.Path)
    args = parser.parse_args()
    stage = args.stage.resolve(strict=True)
    for name in ['model.gguf', 'LICENSE-Qwen.txt', *METADATA]:
        path = stage / name
        if path.is_symlink() or not path.is_file():
            raise ValueError('Non-regular model input: ' + name)
    if (stage / 'model.gguf').stat().st_size != SOURCE['bytes'] or digest(stage / 'model.gguf') != SOURCE['sha256']:
        raise ValueError('Pinned Q8_0 model checksum mismatch')
    for name, expected in METADATA.items():
        if digest(stage / name) != expected:
            raise ValueError('Original model metadata changed: ' + name)
    license_text = (stage / 'LICENSE-Qwen.txt').read_text()
    if 'Apache License' not in license_text or 'Version 2.0' not in license_text:
        raise ValueError('Apache-2.0 license missing')
    (stage / 'PROVENANCE-Q8_0.json').write_text(json.dumps(SOURCE, indent=2) + '\n')
    (stage / 'README-Q8_0.md').write_text(
        '# VoxCue Qwen3 ForcedAligner 0.6B Q8_0\n\n'
        'This independently versioned model resource keeps the original model/config/tokenizer and the source GGUF bytes. '
        'The GGUF contains 8-bit Q8_0 matrix blocks plus F16 convolutions and F32 norms/biases. '
        'It requires a VoxCue runtime with the shared GGUF loader; the old Windows 1.0.0 runtime cannot load it.\n\n'
        'CPU/CUDA tensors are dequantized once when loading into the existing Rust aligner. '
        'This reduces download and disk size; it does not promise half the inference RAM or native int8 matmul. '
        'ASR weights, word splitting, timestamp correction and safe sentence cropping are unchanged.\n\n'
        'Source: https://huggingface.co/' + SOURCE['repository'] + '/tree/' + SOURCE['revision'] + '\n\n'
        'Upstream: https://huggingface.co/' + SOURCE['upstream'] + '/tree/' + SOURCE['upstreamRevision'] + '\n\n'
        'License: Apache-2.0. See LICENSE-Qwen.txt and PROVENANCE-Q8_0.json. '
        'The original BF16 release asset remains available.\n'
    )
    names = sorted(['model.gguf', 'LICENSE-Qwen.txt', *METADATA, 'PROVENANCE-Q8_0.json', 'README-Q8_0.md'])
    args.output.mkdir(parents=True, exist_ok=True)
    asset = 'VoxCue-Qwen-Aligner-Q8_0-1.0.0.zip'
    archive = args.output / asset
    if archive.exists():
        raise ValueError('Refusing to overwrite an existing archive')
    files = []
    with zipfile.ZipFile(archive, 'x', allowZip64=True) as output:
        for name in names:
            file = stage / name
            relative = 'qwen/aligner/' + name
            files.append({'path': relative, 'bytes': file.stat().st_size, 'sha256': digest(file), 'mode': 0o644})
            info = zipfile.ZipInfo(relative, date_time=(2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info._compresslevel = 1
            info.external_attr = 0o100644 << 16
            with output.open(info, 'w', force_zip64=True) as target, file.open('rb') as source:
                shutil.copyfileobj(source, target, 4 * 1024 * 1024)
    if archive.stat().st_size >= 2 * 1024**3:
        raise ValueError('Archive exceeds GitHub asset limit')
    part = {'tag': 'models-v1.0.0', 'asset': asset, 'bytes': archive.stat().st_size,
            'sha256': digest(archive), 'files': files}
    manifest = args.output / 'VoxCue-Qwen-Aligner-Q8_0-1.0.0.manifest.json'
    with manifest.open('x') as file:
        file.write(json.dumps(part, indent=2) + '\n')
    sums = args.output / 'VoxCue-Qwen-Aligner-Q8_0-1.0.0.SHA256SUMS.txt'
    with sums.open('x') as file:
        file.write(f'{part["sha256"]}  {archive.name}\n{digest(manifest)}  {manifest.name}\n')
    if args.catalog:
        with args.catalog.open('x') as file:
            file.write("import type { ComponentArchive } from './catalog';\nexport const qwenInt8Aligner: ComponentArchive = " + json.dumps(part, indent=2) + ';\n')
    print(json.dumps({'asset': asset, 'bytes': part['bytes'], 'sha256': part['sha256'],
                      'originalGgufBytes': SOURCE['bytes'], 'originalGgufSha256': SOURCE['sha256']}), flush=True)


if __name__ == '__main__':
    main()

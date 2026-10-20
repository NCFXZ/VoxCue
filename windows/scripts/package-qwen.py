"""Build three deterministic, independently authenticated model resources.

Development/release tooling only; Python is never required by VoxCue users.
Input is a clean staging directory containing qwen/{asr,aligner,runtime}.
"""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import zipfile

def digest(file):
    result = hashlib.sha256()
    with file.open('rb') as stream:
        for block in iter(lambda: stream.read(4 * 1024 * 1024), b''):
            result.update(block)
    return result.hexdigest()

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('stage', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('--catalog', type=Path)
    parser.add_argument('--reuse-models', action='store_true')
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    parts = []
    previous = json.loads((args.output / 'VoxCue-Qwen-1.0.0.manifest.json').read_text(encoding='utf-8')) if args.reuse_models else None
    for folder, label in [('asr', 'ASR'), ('aligner', 'Aligner'), ('runtime', 'Windows-x64-Runtime')]:
        files = []
        asset = f'VoxCue-Qwen-{label}-1.0.0.zip'
        archive = args.output / asset
        if previous and folder != 'runtime':
            part = next(part for part in previous['parts'] if part['asset'] == asset)
            if digest(archive) != part['sha256']:
                raise RuntimeError('Reused resource checksum mismatch')
            parts.append(part)
            continue
        if archive.exists():
            raise RuntimeError(f'Refusing to overwrite {archive}')
        with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=1, allowZip64=True) as output:
            for file in sorted((args.stage / 'qwen' / folder).rglob('*')):
                if file.is_symlink():
                    raise RuntimeError('Symlink in staging tree')
                if not file.is_file():
                    continue
                name = file.relative_to(args.stage).as_posix()
                descriptor = {'path': name, 'bytes': file.stat().st_size, 'sha256': digest(file), 'mode': 0o644}
                files.append(descriptor)
                info = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
                info.compress_type = zipfile.ZIP_DEFLATED
                info._compresslevel = 1
                info.external_attr = (0o100644 << 16)
                with output.open(info, 'w', force_zip64=True) as target, file.open('rb') as source:
                    shutil.copyfileobj(source, target, 4 * 1024 * 1024)
        if archive.stat().st_size >= 2 * 1024**3:
            raise RuntimeError('Resource exceeds GitHub single asset size')
        parts.append({'tag': 'models-v1.0.0', 'asset': asset, 'bytes': archive.stat().st_size, 'sha256': digest(archive), 'files': files})
        print(asset, archive.stat().st_size, flush=True)
    identity = hashlib.sha256(json.dumps(parts, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    package = {'id': 'qwen', 'target': 'windows-x64', 'label': 'Qwen3-ASR 0.6B 本地语音模型', 'version': '1.0.0', 'tag': 'models-v1.0.0', 'asset': parts[0]['asset'], 'bytes': sum(part['bytes'] for part in parts), 'sha256': identity, 'directory': 'qwen', 'files': [file for part in parts for file in part['files']], 'parts': parts}
    manifest = args.output / 'VoxCue-Qwen-1.0.0.manifest.json'
    manifest.write_text(json.dumps(package, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    sums = '\n'.join(f'{part["sha256"]}  {part["asset"]}' for part in parts)
    sums += f'\n{digest(manifest)}  {manifest.name}\n'
    (args.output / 'VoxCue-Qwen-1.0.0.SHA256SUMS.txt').write_text(sums, encoding='utf-8')
    if args.catalog:
        args.catalog.write_text("import type { ComponentPackage } from './catalog';\nexport const qwenPackage: ComponentPackage = " + json.dumps(dict(package, optional=True), indent=2, ensure_ascii=False) + ';\n', encoding='utf-8')

if __name__ == '__main__':
    main()

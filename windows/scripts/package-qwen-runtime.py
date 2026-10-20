"""Prepare a new immutable Windows runtime asset; never upload or enable it.

The caller supplies a clean runtime containing authenticated DLL/VAD inputs and
the CPU/CUDA executables rebuilt from the current shared sources.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil
import zipfile

parser = argparse.ArgumentParser()
parser.add_argument('runtime', type=Path)
parser.add_argument('output', type=Path)
parser.add_argument('--version', required=True)
args = parser.parse_args()
assert re.fullmatch(r'\d+\.\d+\.\d+', args.version) and args.version != '1.0.0'
expected = {
    'voxcue-qwen.exe', 'voxcue-qwen-cpu.exe', 'speech.dll', 'silero-vad.gguf',
    'cublas64_12.dll', 'cublasLt64_12.dll', 'cudart64_12.dll', 'curand64_10.dll',
    'nvrtc-builtins64_129.dll', 'nvrtc64_120_0.dll', 'vcruntime140.dll', 'vcruntime140_1.dll',
    'LICENSE-NVIDIA-CUDA.txt', 'LICENSE-qwen3-asr-rs.txt', 'LICENSE-speech-cpp.txt',
    'README-nagisa-rs.md', 'README-qwen-aligner.md', 'README-VoxCue.md', 'SOURCES.txt',
}
entries = sorted(args.runtime.rglob('*'))
assert all(not file.is_symlink() for file in entries), 'Symlink in runtime input'
files = [file for file in entries if file.is_file()]
names = {file.relative_to(args.runtime).as_posix() for file in files}
assert {name for name in names if '/' not in name} == expected, 'Unexpected or missing runtime input'
assert all('/' not in name or name.startswith('licenses/') for name in names)
assert any(name.startswith('licenses/') for name in names), 'Keep vendored dependency licenses'
args.output.mkdir(parents=True, exist_ok=True)
asset = f'VoxCue-Qwen-Windows-x64-Runtime-{args.version}.zip'
archive = args.output / asset
manifest = args.output / (asset + '.manifest.json')
assert not archive.exists() and not manifest.exists(), 'Never overwrite an existing asset'


def digest(file):
    with file.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


descriptors = []
with zipfile.ZipFile(archive, 'x', compression=zipfile.ZIP_DEFLATED, compresslevel=1, allowZip64=True) as output:
    for file in files:
        name = 'qwen/runtime/' + file.relative_to(args.runtime).as_posix()
        descriptors.append(dict(path=name, bytes=file.stat().st_size, sha256=digest(file), mode=0o644))
        info = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        info._compresslevel = 1
        info.external_attr = 0o100644 << 16
        with output.open(info, 'w', force_zip64=True) as target, file.open('rb') as source:
            shutil.copyfileobj(source, target, 4 * 1024 * 1024)
assert archive.stat().st_size < 2 * 1024**3
result = dict(tag='models-v1.0.0', asset=asset, bytes=archive.stat().st_size, sha256=digest(archive), files=descriptors)
manifest.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps({key: value for key, value in result.items() if key != 'files'}), flush=True)

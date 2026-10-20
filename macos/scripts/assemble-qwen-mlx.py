"""Assemble the hash-pinned private MLX runtime; no pip or global installations."""
import hashlib
import json
import pathlib
import shutil
import stat
import sys
import tarfile
import urllib.request
import zipfile

destination = pathlib.Path(sys.argv[1]).resolve(strict=True)
cache = pathlib.Path(sys.argv[2]).resolve()
cache.mkdir(parents=True, exist_ok=True)
sources = pathlib.Path(__file__).resolve().parents[1] / 'native'
lock = json.loads((sources / 'qwen-mlx.lock.json').read_text())


def artifact(spec):
    target = cache / spec['sha256']
    if not target.exists():
        partial = target.with_suffix('.partial')
        try:
            with urllib.request.urlopen(spec['url'], timeout=120) as response, partial.open('wb') as output:
                shutil.copyfileobj(response, output, 1024 * 1024)
            partial.rename(target)
        finally:
            partial.unlink(missing_ok=True)
    with target.open('rb') as file:
        if hashlib.file_digest(file, 'sha256').hexdigest() != spec['sha256']:
            raise ValueError('Runtime artifact checksum mismatch')
    return target


def extract(archive, target):
    with tarfile.open(archive) as bundle:
        for member in bundle.getmembers():
            path = pathlib.PurePosixPath(member.name)
            if path.is_absolute() or '..' in path.parts:
                raise ValueError('Invalid archive path')
        bundle.extractall(target, filter='data')
    for path in target.rglob('*'):
        if path.is_symlink() and not path.resolve(strict=True).is_relative_to(target):
            raise ValueError('Archive link escapes runtime')


python = destination / 'cpython-extracted'
python.mkdir()
extract(artifact(lock['python']), python)
target = destination / 'python'
shutil.copytree(python / 'python', target, symlinks=False,
    ignore=shutil.ignore_patterns('__pycache__', '*.pyc', 'site-packages', '*.a'))
for path in (target / 'bin').iterdir():
    if path.name != 'python3.12':
        path.unlink()
shutil.rmtree(python)
site = target / 'lib/python3.12/site-packages'
site.mkdir(parents=True)
for spec in lock['wheels']:
    with zipfile.ZipFile(artifact(spec)) as wheel:
        for item in wheel.infolist():
            relative = pathlib.PurePosixPath(item.filename)
            if relative.is_absolute() or '..' in relative.parts or stat.S_ISLNK(item.external_attr >> 16):
                raise ValueError('Invalid wheel path')
            if '.data' in relative.parts[0]:
                if len(relative.parts) < 3 or relative.parts[1] not in ['purelib', 'platlib']:
                    continue
                relative = pathlib.PurePosixPath(*relative.parts[2:])
            output = site.joinpath(*relative.parts)
            if item.is_dir():
                output.mkdir(parents=True, exist_ok=True)
                continue
            output.parent.mkdir(parents=True, exist_ok=True)
            content = wheel.read(item)
            if output.exists() and output.read_bytes() != content:
                raise ValueError('Conflicting runtime wheel files')
            output.write_bytes(content)
            output.chmod(0o755 if item.external_attr >> 16 & 0o111 else 0o644)
source = destination / 'qwen-source-extracted'
source.mkdir()
extract(artifact(lock['source']), source)
upstream = source / ('mlx-qwen3-asr-' + lock['source']['revision'])
shutil.copytree(upstream / 'mlx_qwen3_asr', site / 'mlx_qwen3_asr',
    ignore=shutil.ignore_patterns('__pycache__', '*.pyc'))
shutil.copyfile(upstream / 'LICENSE', destination / 'LICENSE-mlx-qwen3-asr')
shutil.rmtree(source)
shutil.copyfile(sources / 'qwen-mlx.py', destination / 'mlx-worker.py')
shutil.copyfile(sources / 'qwen-mlx.lock.json', destination / 'SOURCES-MLX.json')
print('Assembled pinned private CPython/MLX BF16 runtime; macOS 14 wheels.', flush=True)

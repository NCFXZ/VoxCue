"""Prepare pinned public source/tools/datasets inside an owned test directory."""
import hashlib, json, os, pathlib, subprocess, sys, tarfile, urllib.request

state_file=pathlib.Path(sys.argv[1]); state=json.loads(state_file.read_text());root=pathlib.Path(state['root'])
owner=json.loads((root/'.voxcue-test-owner.json').read_text())
assert root.name.startswith('voxcue-test-run-') and owner['kind']=='voxcue-test-run-'
os.kill(owner['pid'],0)
def download(url,dest,sha=None):
    if not dest.exists():
        with urllib.request.urlopen(url,timeout=90) as source,open(dest,'wb') as target:
            while data:=source.read(1024*1024):target.write(data)
    digest=hashlib.file_digest(open(dest,'rb'),'sha256').hexdigest()
    if sha:assert digest==sha,(dest,digest,sha)
    return digest
def extract(archive,dest):
    with tarfile.open(archive) as tar:
        for member in tar.getmembers():
            assert not member.name.startswith('/') and '..' not in pathlib.PurePosixPath(member.name).parts
        # Build inputs do not need repository agent configuration or symlinks.
        members=[member for member in tar.getmembers() if not member.issym() and not member.islnk() and '.agents' not in pathlib.PurePosixPath(member.name).parts]
        tar.extractall(dest,members=members,filter='data')
revision='41878a11cf338c59e13edc84bf4cb35f4b0f3ff6'
archive=root/'mlx-source.tar.gz'
state['mlxSourceSha256']=download(f'https://codeload.github.com/moona3k/mlx-qwen3-asr/tar.gz/{revision}',archive,'336b49ade0dcfb02126d66ef1eff1c51e09c08cb4b2e6a60f33745863c16559a')
if not pathlib.Path(state['source']).exists():
    extract(archive,root/'mlx-extract')
    (root/'mlx-extract'/f'mlx-qwen3-asr-{revision}').rename(state['source'])
state['mlxRevision']=revision
version='1.94.0'; name=f'rust-{version}-aarch64-apple-darwin.tar.xz'
url=f'https://static.rust-lang.org/dist/{name}'
checksum='9e55893e014e6aa76924b4cc244a289ad56de4d89d3721fbd5c7f497b31ea33c'
download(url,root/name,checksum)
source=pathlib.Path(state['tools'])/name.removesuffix('.tar.xz');rust=pathlib.Path(state['tools'])/'rust'
if not (rust/'bin/cargo').exists():
    extract(root/name,pathlib.Path(state['tools']))
    subprocess.run(['sh',str(source/'install.sh'),f'--prefix={rust}','--components=rustc,cargo,rust-std-aarch64-apple-darwin','--disable-ldconfig'],check=True)
state['cargo']=str(rust/'bin/cargo');state['rustc']=str(rust/'bin/rustc');state['rustSha256']=checksum
for repo,rev,dest in [('speech.cpp','a72f1bbedd50e293d5b3f4c2bf0fb44ec003227d','speech-cpp'),('ggml','a655cf6910770404213bc338e622cd82b08ca277','ggml-source')]:
    repo_path='nyosegawa/'+repo
    if not (root/dest).exists() and not (dest=='ggml-source' and (root/'speech-cpp/ggml/CMakeLists.txt').exists()):
        archive=root/(dest+'.tar.gz');download(f'https://codeload.github.com/{repo_path}/tar.gz/{rev}',archive)
        extract(archive,root/(dest+'-extract'))
        (root/(dest+'-extract')/(repo+'-'+rev)).rename(root/dest)
state['speechCpp']=str(root/'speech-cpp')
import shutil
if (root/'ggml-source').exists():
    shutil.rmtree(root/'speech-cpp'/'ggml');shutil.move(str(root/'ggml-source'),str(root/'speech-cpp'/'ggml'))
state_file.write_text(json.dumps({**json.loads(state_file.read_text()),**state}))
print('PINNED_SOURCES_READY',flush=True)

"""Short isolated native smoke using only the fixed public Qwen example.
No capture devices, user profile, recordings or retained transcript files.
"""
import argparse
import base64
import io
import hashlib
import json
import os
from pathlib import Path
import queue
import subprocess
import threading
import time
import urllib.request
import wave

parser = argparse.ArgumentParser()
parser.add_argument('component', type=Path)
parser.add_argument('--device', choices=['cpu', 'cuda'], default='cuda')
parser.add_argument('--wave', type=Path)
parser.add_argument('--require-crop', action='store_true')
parser.add_argument('--repeat', type=int, choices=range(1, 5), default=1)
args = parser.parse_args()
runtime = args.component / 'runtime'
run_root = next((parent for parent in args.component.resolve().parents
                 if parent.name.startswith('voxcue-test-run-')
                 and (parent / '.voxcue-test-owner.json').is_file()), None)
if run_root is None:
    raise RuntimeError('Qwen native checks require an owned temporary component')
owner = json.loads((run_root / '.voxcue-test-owner.json').read_text(encoding='utf-8'))
if owner.get('kind') != 'voxcue-test-run-' or not isinstance(owner.get('pid'), int) or owner['pid'] <= 0:
    raise RuntimeError('Invalid temporary component owner')
cuda_cache = run_root / 'qwen-cuda-cache'
cuda_cache.mkdir(exist_ok=True)
environment = dict(os.environ, PATH=str(runtime) + os.pathsep + os.environ.get('PATH', ''),
                   RAYON_NUM_THREADS='4', CUDA_CACHE_PATH=str(cuda_cache))
child = subprocess.Popen([str(runtime / ('voxcue-qwen-cpu.exe' if args.device == 'cpu' else 'voxcue-qwen.exe')), str(args.component), args.device], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=None if os.environ.get("VOXCUE_QWEN_DIAGNOSTICS") else subprocess.DEVNULL, env=environment, cwd=runtime, creationflags=subprocess.CREATE_NO_WINDOW)
events = queue.Queue()
def read():
    for line in child.stdout:
        events.put(json.loads(line))
threading.Thread(target=read, daemon=True).start()
all_events = []
def wait(kind, seq=None):
    deadline = time.monotonic() + 180
    while time.monotonic() < deadline:
        event = events.get(timeout=max(.1, deadline-time.monotonic()))
        all_events.append(event)
        if event['type'] == 'error':
            raise RuntimeError(event)
        if event['type'] == kind and (seq is None or event.get('seq') == seq):
            return event
    raise TimeoutError(kind)
sequence = 0
def send(op, source='system', **fields):
    global sequence
    sequence += 1
    child.stdin.write((json.dumps(dict(op=op, source=source, seq=sequence, **fields))+'\n').encode())
    child.stdin.flush()
    wait('ack', sequence)
try:
    ready = wait('ready')
    assert ready['async_alignment'] is True, 'This test requires the rebuilt 0.5.3 runtime'
    assert ready['device'] == args.device
    assert ready['chunk_ms'] == (500 if args.device == 'cuda' and ready['vram_bytes'] >= 4*1024**3 else 1000)
    send('start')
    send('start', 'microphone')
    for _ in range(5):
        send('audio', 'microphone', audio=base64.b64encode(bytes(6400)).decode())
    with_audio = args.device == 'cuda' or args.wave is not None
    if with_audio:
        if args.wave:
            data = args.wave.read_bytes()
        else:
            with urllib.request.urlopen('https://qianwen-res.oss-cn-beijing.aliyuncs.com/Qwen3-ASR-Repo/asr_zh.wav') as response:
                data = response.read()
        with wave.open(io.BytesIO(data)) as audio:
            assert audio.getframerate() == 16000 and audio.getnchannels() == 1 and audio.getsampwidth() == 2
            pcm = audio.readframes(audio.getnframes())
        combined = (pcm + bytes(4800)) * args.repeat + bytes(32000) if args.wave else (pcm + bytes(4800))*6 + bytes(32000)
        for offset in range(0, len(combined), 6400):
            send('audio', audio=base64.b64encode(combined[offset:offset+6400]).decode())
            if offset and offset % 320000 == 0:
                print(json.dumps(dict(device=args.device, processed_input_ms=offset//32)), flush=True)
    send('finish')
    send('finish', 'microphone')
    child.stdin.close()
    child.wait(timeout=10)
    assert child.returncode == 0
    assert not [event for event in all_events if event.get('session') == 'microphone' and event['type'] in ['partial', 'committed', 'tail_final']]
    if with_audio:
        assert any(event['type'] == 'partial' and event.get('text') for event in all_events)
        assert any(event['type'] == 'tail_final' and event.get('reason') == 'pause' for event in all_events)
        for event in all_events:
            if event['type'] == 'committed':
                assert event['removed_chunk_ms'] > 0 and event['cut_ms'] > event['window_start_ms']
        if args.require_crop:
            if not any(event['type'] == 'committed' for event in all_events):
                print('SYNTHETIC_DIAGNOSTIC', json.dumps([dict(type=event['type'], characters=len(event.get('text', '')), buffer_ms=event.get('buffer_ms')) for event in all_events if event['type'] in ['partial', 'tail_final', 'alignment_deferred']][-4:]))
            assert any(event['type'] == 'committed' for event in all_events), 'Four-sentence crop did not occur'
    transcript = ''.join(event.get('text', '') for event in all_events if event.get('session') == 'system' and event['type'] in ['committed', 'tail_final'])
    normalized = ''.join(c for c in transcript.lower() if c.isalnum())
    print(json.dumps(dict(device=ready['device'], chunk_ms=ready['chunk_ms'], alignment_device=ready['alignment_device'], load_ms=ready['load_ms'], partials=sum(event['type']=='partial' for event in all_events), crops=sum(event['type']=='committed' for event in all_events), audio_ms=max((event.get('audio_ms', 0) for event in all_events), default=0), max_buffer_ms=max((event.get('buffer_ms', 0) for event in all_events), default=0), transcript_sha256=hashlib.sha256(normalized.encode()).hexdigest(), characters=len(normalized), exited=child.returncode), ensure_ascii=False))
finally:
    if child.poll() is None:
        child.kill()
        child.wait(timeout=10)

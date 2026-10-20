"""Owning-pipe cancellation with the actual Windows EXE; public PCM only."""
import argparse
import base64
import json
import os
from pathlib import Path
import queue
import subprocess
import threading
import time
import wave

parser = argparse.ArgumentParser()
parser.add_argument('component', type=Path)
parser.add_argument('wave', type=Path)
args = parser.parse_args()
with wave.open(str(args.wave)) as audio:
    assert (audio.getframerate(), audio.getnchannels(), audio.getsampwidth()) == (16000, 1, 2)
    pcm = audio.readframes(audio.getnframes())
for device in ['cpu', 'cuda']:
    runtime = args.component / 'runtime'
    for phase in ['loading', 'running']:
        child = subprocess.Popen([str(runtime / ('voxcue-qwen-cpu.exe' if device == 'cpu' else 'voxcue-qwen.exe')),
                                  str(args.component), device], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                 stderr=subprocess.DEVNULL, cwd=runtime,
                                 env=dict(os.environ, PATH=str(runtime) + os.pathsep + os.environ.get('PATH', '')),
                                 creationflags=subprocess.CREATE_NO_WINDOW)
        try:
            events = queue.Queue()
            def read(child=child, events=events):
                for line in child.stdout:
                    events.put(json.loads(line))
                events.put({'type': 'exit'})
            threading.Thread(target=read, daemon=True).start()
            if phase == 'running':
                assert events.get(timeout=180)['type'] == 'ready'
                commands = [dict(op='start', source='system', seq=1)]
                commands += [dict(op='audio', source='system', seq=2+i,
                                  audio=base64.b64encode(pcm[offset:offset+6400]).decode())
                             for i, offset in enumerate(range(0, min(len(pcm), 32000), 6400))]
                for command in commands:
                    child.stdin.write((json.dumps(command) + '\n').encode())
                    child.stdin.flush()
                    while True:
                        event = events.get(timeout=120)
                        assert event['type'] not in ['error', 'exit'], event
                        if event['type'] == 'ack' and event['seq'] == command['seq']:
                            break
            at = time.monotonic()
            child.stdin.close()
            child.wait(timeout=10)
            assert child.returncode == 0
            print(json.dumps(dict(device=device, owner_eof=phase, exit_ms=round((time.monotonic()-at)*1000))), flush=True)
        finally:
            if child.poll() is None:
                child.kill()
                child.wait()

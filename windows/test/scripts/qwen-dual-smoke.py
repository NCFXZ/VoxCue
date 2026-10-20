"""Two actual overlapping native streams; fixed public synthetic-continuous PCM."""
import argparse
import base64
import json
import os
from pathlib import Path
import queue
import subprocess
import threading
import wave

parser = argparse.ArgumentParser()
parser.add_argument('component', type=Path)
parser.add_argument('system', type=Path)
parser.add_argument('microphone', type=Path)
args = parser.parse_args()
runtime = args.component / 'runtime'
child = subprocess.Popen([str(runtime / 'voxcue-qwen.exe'), str(args.component), 'cuda'],
                         stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                         cwd=runtime, creationflags=subprocess.CREATE_NO_WINDOW,
                         env=dict(os.environ, PATH=str(runtime)+os.pathsep+os.environ.get('PATH', '')))
events, pending = [], queue.Queue()


def read():
    for line in child.stdout:
        pending.put(json.loads(line))
    pending.put({'type': 'exit'})


threading.Thread(target=read, daemon=True).start()


def wait(kind, sequence=None):
    while True:
        event = pending.get(timeout=180)
        events.append(event)
        assert event['type'] not in ['error', 'exit'], event
        if event['type'] == kind and (sequence is None or event.get('seq') == sequence):
            return event


sequence = 0


def send(op, source, **values):
    global sequence
    sequence += 1
    child.stdin.write((json.dumps(dict(op=op, source=source, seq=sequence, **values))+'\n').encode())
    child.stdin.flush()
    wait('ack', sequence)


try:
    ready = wait('ready')
    assert ready['device'] == 'cuda' and ready['async_alignment'] is True
    streams = {}
    for source in ['system', 'microphone']:
        with wave.open(str(getattr(args, source))) as audio:
            assert (audio.getframerate(), audio.getnchannels(), audio.getsampwidth()) == (16000, 1, 2)
            pcm = audio.readframes(audio.getnframes())
        streams[source] = (pcm + bytes(4800))*2 + bytes(32000)
        send('start', source)
    for offset in range(0, max(map(len, streams.values())), 6400):
        for source, pcm in streams.items():
            block = pcm[offset:offset+6400]
            if block:
                send('audio', source, audio=base64.b64encode(block).decode())
    for source in streams:
        send('finish', source)
    for source in streams:
        lane = [event for event in events if event.get('session') == source]
        assert any(event['type'] == 'speech_start' for event in lane)
        assert any(event['type'] == 'partial' and event.get('text') for event in lane)
        crops = [event for event in lane if event['type'] == 'committed']
        assert crops, source + ': alignment must service both active sources'
        assert all(event['removed_chunk_ms'] > 0 and event['cut_ms'] > event['window_start_ms'] for event in crops)
        assert any(event['type'] == 'tail_final' and event['reason'] == 'pause' for event in lane)
        print(json.dumps(dict(source=source, crops=len(crops),
                              max_buffer_ms=max((event.get('buffer_ms', 0) for event in lane), default=0))), flush=True)
    child.stdin.close()
    child.wait(timeout=10)
    assert child.returncode == 0
    print('PASS actual overlapping Qwen CUDA streams: independent VAD, partials, fair asynchronous crops and final tails', flush=True)
finally:
    if child.poll() is None:
        child.kill()
        child.wait()

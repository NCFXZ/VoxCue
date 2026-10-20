"""Same-code BF16/Q8_0 word timestamps/cuts on fixed public input. Stdout only."""
import argparse
import base64
import ctypes
from ctypes import wintypes
import json
import math
import os
from pathlib import Path
import queue
import subprocess
import threading
import wave

parser = argparse.ArgumentParser()
parser.add_argument('baseline', type=Path)
parser.add_argument('quantized', type=Path)
parser.add_argument('benchmark', type=Path)
parser.add_argument('corpus', type=Path)
parser.add_argument('--device', choices=['cpu', 'cuda'], required=True)
args = parser.parse_args()


class MemoryCounters(ctypes.Structure):
    _fields_ = [('cb', wintypes.DWORD), ('faults', wintypes.DWORD)] + [
        (name, ctypes.c_size_t) for name in ['peak_rss', 'rss', 'peak_paged', 'paged',
                                            'peak_nonpaged', 'nonpaged', 'pagefile', 'peak_pagefile', 'private']]


def memory(child):
    counters = MemoryCounters()
    counters.cb = ctypes.sizeof(counters)
    read = ctypes.windll.psapi.GetProcessMemoryInfo
    read.argtypes = [wintypes.HANDLE, ctypes.POINTER(MemoryCounters), wintypes.DWORD]
    assert read(int(child._handle), ctypes.byref(counters), counters.cb)
    return {name: round(getattr(counters, name) / 1024**2, 1) for name in ['rss', 'peak_rss', 'private']}


class Aligner:
    def __init__(self, root):
        environment = dict(os.environ, PATH=str(root / 'runtime') + os.pathsep + os.environ.get('PATH', ''))
        self.child = subprocess.Popen([str(args.benchmark), str(root / 'aligner'), args.device],
                                      stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                      stderr=subprocess.DEVNULL, env=environment, creationflags=subprocess.CREATE_NO_WINDOW)
        self.events = queue.Queue()
        def read():
            for line in self.child.stdout:
                self.events.put(json.loads(line))
            self.events.put({'type': 'exit'})
        threading.Thread(target=read, daemon=True).start()
        self.ready = self.events.get(timeout=180)
        assert self.ready['type'] == 'ready', self.ready
        self.latency = []

    def run(self, request):
        self.child.stdin.write((json.dumps(request) + '\n').encode())
        self.child.stdin.flush()
        event = self.events.get(timeout=180)
        assert event['type'] == 'result' and event['id'] == request['id'], event
        self.latency.append(event['elapsed_ms'])
        return event['result']

    def close(self):
        self.child.stdin.close()
        try:
            self.child.wait(timeout=10)
        except subprocess.TimeoutExpired:
            self.child.kill()
            self.child.wait()
        assert self.child.returncode == 0


engines = []
try:
    for root in [args.baseline, args.quantized]:
        engines.append(Aligner(root))
    differences, cuts = [], []
    items = json.loads(args.corpus.read_text(encoding='utf-8'))
    for item in items:
        if item['id'] == 'sample1':
            continue
        with wave.open(str(item['audio'])) as audio:
            assert (audio.getframerate(), audio.getnchannels(), audio.getsampwidth()) == (16000, 1, 2)
            pcm = audio.readframes(audio.getnframes())
        request = dict(id=item['id'], audio=base64.b64encode(pcm).decode(), text=item['reference'], language=item['language'])
        original, quantized = [engine.run(request)['items'] for engine in engines]
        assert len(original) == len(quantized) and len(original) > 5
        for a, b in zip(original, quantized):
            assert a['text'] == b['text']
            for key in ['start_time', 'end_time']:
                assert math.isfinite(a[key]) and math.isfinite(b[key])
                differences.append(abs(a[key] - b[key]))
        separator = '。' if item['language'] == 'Chinese' else '.'
        first = item['reference'].split(separator)[0] + separator
        results = [engine.run(dict(request, op='cut', first=first)) for engine in engines]
        assert all('cut_sample' in result for result in results), results
        for result in results:
            assert result['left'] <= result['cut_sample'] / 16000 <= result['right']
        cuts.append(abs(results[0]['cut_sample'] - results[1]['cut_sample']) / 16)
    assert max(differences) <= 0.12, max(differences)
    assert max(cuts) <= 80, cuts
    print(json.dumps(dict(device=args.device, aligned_words=len(differences)//2,
                          max_boundary_delta_ms=round(max(differences)*1000, 3),
                          max_cut_delta_ms=max(cuts),
                          bf16_load_ms=engines[0].ready['load_ms'], q8_load_ms=engines[1].ready['load_ms'],
                          bf16_memory_mib=memory(engines[0].child), q8_memory_mib=memory(engines[1].child),
                          bf16_inference_ms=engines[0].latency, q8_inference_ms=engines[1].latency)), flush=True)
finally:
    for engine in engines:
        engine.close()

"""Compare original BF16 engines on owned, fixed public inputs; stdout results only."""
import argparse
import base64
import collections
import ctypes as C
import json
import os
import pathlib
import statistics
import subprocess
import threading
import time
import unicodedata
import wave

parser = argparse.ArgumentParser()
parser.add_argument('fixture')
parser.add_argument('--backend', choices=['rust', 'mlx', 'native'], required=True)
parser.add_argument('--limit', type=int, default=0)
parser.add_argument('--chunk-ms', type=int, choices=[500, 1000], default=500)
parser.add_argument('--realtime-seconds', type=int, default=0)
parser.add_argument('--long-speech', action='store_true')
parser.add_argument('--cold-crop', action='store_true')
args = parser.parse_args()
fixture = json.loads(pathlib.Path(args.fixture).read_text())
root = pathlib.Path(fixture['root'])
owner = json.loads((root / '.voxcue-test-owner.json').read_text())
assert root.name.startswith('voxcue-test-run-') and owner['kind'] == 'voxcue-test-run-'
os.kill(owner['pid'], 0)
os.environ.update(HF_HUB_OFFLINE='1', HF_HUB_DISABLE_TELEMETRY='1',
                  HF_HOME=str(root / 'hf-cache'), TOKENIZERS_PARALLELISM='false')
import numpy as np


def pcm(item):
    with wave.open(item['audio']) as f:
        assert f.getnchannels() == 1 and f.getframerate() == 16000 and f.getsampwidth() == 2
        data = f.readframes(f.getnframes())
        assert np.max(np.abs(np.frombuffer(data, dtype='<i2').astype(np.int32))) > 100, 'Silent or wrongly scaled fixture'
        return data + bytes(32000)


def units(text, language):
    text = unicodedata.normalize('NFKC', text).lower()
    text = ''.join(c if c.isalnum() or c.isspace() else ' ' for c in text)
    return text.split() if language == 'en_us' else list(''.join(text.split()))


def distance(a, b):
    previous = list(range(len(b) + 1))
    for i, x in enumerate(a):
        current = [i + 1]
        for j, y in enumerate(b):
            current.append(min(current[-1] + 1, previous[j + 1] + 1, previous[j] + (x != y)))
        previous = current
    return previous[-1]


def quantiles(values):
    return {f'p{q}': round(float(np.percentile(values, q)), 2) for q in [50, 95, 99]} if values else {}


class Rust:
    def __init__(self):
        runtime = pathlib.Path(__file__).resolve().parents[2] / 'native/bin/qwen/voxcue-qwen'
        self.child = subprocess.Popen([str(runtime), fixture['component'], 'metal',
                                       f'--chunk-ms={args.chunk_ms}'] + (['--asr=rust'] if args.backend == 'rust' else []) + (['--cold-crop'] if args.cold_crop else []),
                                      stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                      text=True, env={**os.environ, 'VOXCUE_QWEN_DIAGNOSTICS': '1'})
        self.errors = collections.deque(maxlen=20)
        self.reader = threading.Thread(target=lambda: self.errors.extend(self.child.stderr), daemon=True)
        self.reader.start()
        self.sequence = 0
        self.events = []
        self.ready = self.read()
        assert self.ready['type'] == 'ready', self.ready

    def read(self):
        line = self.child.stdout.readline()
        if not line:
            raise RuntimeError('Native engine exited: ' + ''.join(self.errors))
        event = json.loads(line)
        event['_at'] = time.perf_counter()
        if event['type'] == 'error':
            raise RuntimeError(str(event) + ''.join(self.errors))
        return event

    def send(self, op, source='system', **extra):
        self.sequence += 1
        self.child.stdin.write(json.dumps(dict(op=op, source=source, seq=self.sequence, **extra)) + '\n')
        self.child.stdin.flush()
        while True:
            event = self.read()
            if event['type'] == 'ack' and event['seq'] == self.sequence:
                break
            self.events.append(event)

    def run(self, data):
        self.events = []
        self.send('start')
        started = time.perf_counter()
        for i in range(0, len(data), 6400):
            self.send('audio', audio=base64.b64encode(data[i:i + 6400]).decode())
        self.send('finish')
        elapsed = time.perf_counter() - started
        finals = [e['text'] for e in self.events if e['type'] in ['committed', 'tail_final']]
        partials = [e['inference_ms'] for e in self.events if e['type'] == 'partial']
        final_ms = [e['inference_ms'] for e in self.events if e['type'] == 'tail_final']
        return ' '.join(finals), elapsed, partials, final_ms

    def close(self):
        self.child.stdin.close()
        try:
            self.child.wait(timeout=10)
        except subprocess.TimeoutExpired:
            self.child.kill()
            self.child.wait()


class Vad:
    """The exact production Silero library, thresholds, frame size and leading ring."""
    def __init__(self):
        baseline = root / 'baseline'
        # The production executable supplies @loader_path; this standalone
        # Python benchmark preloads the same signed VAD dependencies explicitly.
        self.dependencies = [C.CDLL(str(baseline / name)) for name in
            ['libggml-base.0.dylib', 'libggml-cpu.0.dylib', 'libggml-blas.0.dylib', 'libggml.0.dylib']]
        self.lib = C.CDLL(str(baseline / 'libspeech.dylib'))
        p, i, z, f = C.c_void_p, C.c_int, C.c_size_t, C.c_float
        signatures = {
            'speech_load_params_new': ([C.POINTER(p)], i),
            'speech_load_params_set_device': ([p, C.c_char_p], i),
            'speech_load_params_set_threads': ([p, i], i),
            'speech_model_load': ([C.c_char_p, p, C.POINTER(p)], i),
            'speech_request_new': ([p, C.POINTER(p)], i),
            'speech_request_set_int': ([p, i, C.c_int64], i),
            'speech_request_set_float': ([p, i, C.c_double], i),
            'speech_detection_start': ([p, i, C.POINTER(p)], i),
            'speech_detection_push': ([p, C.POINTER(f), z], i),
            'speech_detection_speaking': ([p, C.POINTER(C.c_double), C.POINTER(i)], i),
            'speech_detection_region_count': ([p], z),
            'speech_load_params_free': ([p], None), 'speech_model_free': ([p], None),
            'speech_request_free': ([p], None), 'speech_detection_free': ([p], None),
        }
        for name, (parameters, result) in signatures.items():
            function = getattr(self.lib, name)
            function.argtypes, function.restype = parameters, result
        params = p()
        self.model, self.request, self.detection = p(), p(), p()
        self.check(self.lib.speech_load_params_new(C.byref(params)))
        try:
            self.check(self.lib.speech_load_params_set_device(params, b'CPU'))
            self.check(self.lib.speech_load_params_set_threads(params, 2))
            self.check(self.lib.speech_model_load(os.fsencode(baseline / 'silero-vad.gguf'), params, C.byref(self.model)))
        finally:
            self.lib.speech_load_params_free(params)
        self.check(self.lib.speech_request_new(self.model, C.byref(self.request)))
        self.check(self.lib.speech_request_set_float(self.request, 39, .5))
        for option, value in [(40, 100), (41, 800), (42, 100)]:
            self.check(self.lib.speech_request_set_int(self.request, option, value))
        self.reset()

    def check(self, result):
        if result != 0:
            raise RuntimeError('Silero VAD failed: ' + str(result))

    def reset(self):
        self.lib.speech_detection_free(self.detection)
        self.detection = C.c_void_p()
        self.check(self.lib.speech_detection_start(self.request, 16000, C.byref(self.detection)))

    def push(self, samples):
        self.check(self.lib.speech_detection_push(self.detection, samples.ctypes.data_as(C.POINTER(C.c_float)), len(samples)))
        start, kept = C.c_double(), C.c_int()
        speaking = self.lib.speech_detection_speaking(self.detection, C.byref(start), C.byref(kept))
        return bool(speaking and kept.value), round(start.value * 16000), self.lib.speech_detection_region_count(self.detection) > 0

    def close(self):
        self.lib.speech_detection_free(self.detection)
        self.lib.speech_request_free(self.request)
        self.lib.speech_model_free(self.model)


class Mlx:
    def __init__(self):
        import mlx.core as mx
        from mlx_qwen3_asr.load_models import load_model
        from mlx_qwen3_asr import streaming
        self.mx, self.streaming = mx, streaming
        self.directory = str(pathlib.Path(fixture['component']) / 'asr')
        started = time.perf_counter()
        self.model, _ = load_model(self.directory, dtype=mx.bfloat16)
        mx.eval(self.model.parameters())
        assert self.model.model.embed_tokens.weight.dtype == mx.bfloat16
        self.ready = dict(type='ready', backend='mlx', dtype='bfloat16', load_ms=round((time.perf_counter() - started) * 1000))
        self.sources = {}

    def run(self, data):
        stream = MlxStream(self, 'system')
        started = time.perf_counter()
        try:
            stream.feed(data)
            stream.finish()
            return ' '.join(e['text'] for e in stream.events if e['type'] == 'tail_final'), time.perf_counter() - started, [e['inference_ms'] for e in stream.events if e['type'] == 'partial'], [e['inference_ms'] for e in stream.events if e['type'] == 'tail_final']
        finally:
            stream.close()

    def close(self):
        for source in self.sources.values():
            source.close()


class MlxStream:
    def __init__(self, engine, source):
        self.engine, self.source, self.vad = engine, source, Vad()
        self.state = None
        self.ring = np.array([], dtype=np.float32)
        self.pending = np.array([], dtype=np.float32)
        self.cursor = self.base = 0
        self.events = []

    def feed(self, data):
        samples = np.frombuffer(data, dtype='<i2').astype(np.float32) / 32768
        samples = np.concatenate([self.pending, samples])
        n = len(samples) // 512 * 512
        self.pending = samples[n:]
        for i in range(0, n, 512):
            self.frame(samples[i:i + 512])

    def frame(self, frame):
        e = self.engine
        self.cursor += len(frame)
        self.ring = np.concatenate([self.ring, frame])[-16000:]
        kept, start, ended = self.vad.push(frame)
        feed = None
        if self.state is not None:
            feed = frame
        elif kept:
            oldest = self.cursor - len(self.ring)
            begin = min(self.cursor, max(self.base + start, oldest))
            feed = self.ring[begin - oldest:]
            self.state = e.streaming.init_streaming(model=e.directory, dtype=e.mx.bfloat16,
                chunk_size_sec=args.chunk_ms / 1000, max_context_sec=121, max_new_tokens=32,
                unfixed_chunk_num=2, unfixed_token_num=5, reuse_window_prefix=True, commit_at_silence=False)
        if feed is not None:
            step = self.state.chunk_id
            clock = time.perf_counter()
            e.streaming.feed_audio(feed, self.state, model=e.model)
            if step != self.state.chunk_id:
                self.record('partial', clock)
        if ended:
            self.finalize()

    def record(self, kind, clock):
        self.events.append(dict(type=kind, session=self.source, text=self.state.text,
            inference_ms=(time.perf_counter() - clock) * 1000, audio_ms=self.cursor / 16,
            _at=time.perf_counter()))

    def finalize(self):
        e = self.engine
        if self.state is not None:
            self.state.max_new_tokens = 256
            clock = time.perf_counter()
            if len(self.state.buffer):
                e.streaming.finish_streaming(self.state, model=e.model)
            elif len(self.state.audio_accum):
                e.streaming._decode_and_update(self.state, model=e.model)
            self.record('tail_final', clock)
            self.state = None
        self.vad.reset()
        self.base, self.ring = self.cursor, np.array([], dtype=np.float32)

    def finish(self):
        if len(self.pending):
            self.frame(self.pending)
            self.pending = np.array([], dtype=np.float32)
        self.finalize()

    def close(self):
        self.vad.close()


def realtime(engine, items):
    names = ['system', 'microphone']
    data = [pcm(next(item for item in items if item['language'] == language)) for language in ['en_us', 'cmn_hans_cn']]
    if args.long_speech:
        sentence = ('The first project improved our customer service. We tested the new system with synthetic examples. '
                    'Our team reviewed the results carefully. The next release will include better search. '
                    'We also improved the user interface. Finally we checked that every process stopped correctly. ')
        aiff, wav = root / 'corpus/long.aiff', root / 'corpus/long.wav'
        if not wav.exists():
            subprocess.run(['/usr/bin/say', '-r', '165', '-o', str(aiff), sentence * 3], check=True)
            subprocess.run(['/usr/bin/afconvert', '-f', 'WAVE', '-d', 'LEI16@16000', '-c', '1', str(aiff), str(wav)], check=True)
        data = [pcm(dict(audio=str(wav)))] * 2
    size = args.realtime_seconds * 32000
    data = [(audio + bytes(max(0, size - len(audio))))[:size] if args.long_speech else (audio * (size // len(audio) + 1))[:size] for audio in data]
    lags = []
    for name in names:
        if args.backend != 'mlx':
            engine.send('start', name)
        else:
            engine.sources[name] = MlxStream(engine, name)
    engine.events = []
    started = time.perf_counter()
    processed = 0
    # Match capture callbacks at 20ms; 200ms batches create artificial 400/600ms cadence.
    packet = 640
    for offset in range(0, size, packet):
        end = min(offset + packet, size)
        wait = started + end / 32000 - time.perf_counter()
        if wait > 0:
            time.sleep(wait)
        for index, name in enumerate(names):
            block = data[index][offset:end]
            if args.backend != 'mlx':
                engine.send('audio', name, audio=base64.b64encode(block).decode())
            else:
                engine.sources[name].feed(block)
        processed = end
        lag = (time.perf_counter() - started - end / 32000) * 1000
        lags.append(lag)
        if lag > 5000:
            break
    processing_elapsed = time.perf_counter() - started
    for name in names:
        if args.backend != 'mlx':
            engine.send('finish', name)
        else:
            engine.sources[name].finish()
    events = engine.events if args.backend != 'mlx' else sorted([event for stream in engine.sources.values() for event in stream.events], key=lambda event: event['_at'])
    partials = [event for event in events if event['type'] == 'partial']
    intervals, latency = [], []
    previous = {}
    for event in events:
        name = event.get('session')
        if event['type'] in ['tail_final', 'committed']:
            previous.pop(name, None)
        if event['type'] != 'partial':
            continue
        latency.append((event['_at'] - started) * 1000 - event['audio_ms'])
        if name in previous:
            intervals.append((event['_at'] - previous[name]) * 1000)
        previous[name] = event['_at']
    print('REALTIME:' + json.dumps(dict(backend=args.backend, sources=2, chunk_ms=args.chunk_ms,
        requested_seconds=args.realtime_seconds, processed_seconds=processed / 32000,
        wall_seconds=round(processing_elapsed, 3), stopped_for_backlog=processed < size,
        ack_lag_ms=quantiles(lags), final_ack_lag_ms=round(lags[-1], 2),
        partial_latency_ms=quantiles(latency), partial_interval_ms=quantiles(intervals),
        inference_ms=quantiles([event['inference_ms'] for event in partials]), partials=len(partials))), flush=True)
    if args.long_speech:
        crops = [event for event in events if event['type'] == 'committed']
        print('ALIGNMENT_STRESS:' + json.dumps(dict(crops=len(crops),
            sources=sorted(set(event.get('session') for event in crops)),
            stale=sum(event['type'] == 'alignment_deferred' for event in events),
            preserved_new_audio=sum(event.get('audio_ms', 0) > event.get('alignment_snapshot_ms', float('inf')) for event in crops))), flush=True)
        if args.realtime_seconds >= len(data[0]) / 32000 and args.realtime_seconds >= 66:
            expected = units(sentence * 3, 'en_us')
            for name in names:
                text = ' '.join(event['text'] for event in events if event.get('session') == name and event['type'] in ['committed', 'tail_final'])
                actual = units(text, 'en_us')
                errors = distance(expected, actual)
                print('LONG_ACCURACY:' + json.dumps(dict(source=name, errors=errors, units=len(expected),
                    error_percent=round(errors / len(expected) * 100, 3), cold_crop=args.cold_crop)), flush=True)
        assert {event['session'] for event in crops} == set(names), 'Both sources must actually crop while ASR runs'


manifest = json.loads((root / 'corpus/manifest.json').read_text())
items = manifest['items']
if args.limit:
    items = [item for language in ['en_us', 'cmn_hans_cn']
             for item in [i for i in items if i['language'] == language][:max(1, args.limit // 2)]]
engine = Mlx() if args.backend == 'mlx' else Rust()
print('READY:' + json.dumps(engine.ready), flush=True)
try:
    engine.run(pcm(items[0]))
    print('WARMED:' + args.backend, flush=True)
    if args.realtime_seconds:
        realtime(engine, items)
        raise SystemExit(0)
    scores, durations, costs, partials, final_costs = {}, [], [], [], []
    for item in items:
        text, elapsed, steps, finals = engine.run(pcm(item))
        assert steps and text.strip(), 'No decoded speech: inspect input/VAD before scoring'
        expected, actual = units(item['reference'], item['language']), units(text, item['language'])
        errors = distance(expected, actual)
        score = scores.setdefault(item['language'], dict(errors=0, units=0, clips=0))
        score['errors'] += errors
        score['units'] += len(expected)
        score['clips'] += 1
        durations.append(item['duration'])
        costs.append(elapsed)
        partials.extend(steps)
        final_costs.extend(finals)
        print('CLIP:' + json.dumps(dict(backend=args.backend, id=item['id'], seconds=item['duration'],
            elapsed=round(elapsed, 3), errors=errors, units=len(expected), partial_ms=quantiles(steps),
            reference=item['reference'], hypothesis=text), ensure_ascii=False), flush=True)
    for score in scores.values():
        score['error_percent'] = round(score['errors'] / score['units'] * 100, 3)
    print('SUMMARY:' + json.dumps(dict(backend=args.backend, chunk_ms=args.chunk_ms, weights='original BF16 0.6B',
        dataset=manifest['dataset'], revision=manifest['revision'], clips=len(items), audio_seconds=round(sum(durations), 3),
        compute_seconds=round(sum(costs), 3), rtf=round(sum(costs) / sum(durations), 4),
        partial_ms=quantiles(partials), partial_over_500=sum(v > 500 for v in partials), partial_count=len(partials),
        final_ms=quantiles(final_costs), accuracy=scores)), flush=True)
finally:
    engine.close()

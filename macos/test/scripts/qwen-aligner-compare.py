"""Compare BF16/Q8_0 using identical Rust code and fixed public FLEURS inputs.

Developer-only: root must be an owned temporary aligner-int8-evaluation directory.
All measurements and timestamp results stay in memory and stdout.
"""
import argparse
import base64
import collections
import json
import math
import os
import pathlib
import select
import subprocess
import threading
import wave
import numpy as np

parser = argparse.ArgumentParser()
parser.add_argument('root', type=pathlib.Path)
parser.add_argument('--rounds', type=int, default=2)
args = parser.parse_args()
root = args.root.resolve(strict=True)
assert root.parent == pathlib.Path('/private/tmp') and root.name.startswith('voxcue-aligner-int8-')
assert json.loads((root / '.voxcue-test-owner.json').read_text())['kind'] == 'aligner-int8-evaluation'
assert 1 <= args.rounds <= 4
manifest = json.loads((root / 'voxcue-test-run-corpus/corpus/manifest.json').read_text())
assert manifest['revision'] == '168de341b3db6859a9bac1c50a2ef5e3b47647e0' and len(manifest['items']) == 40
repository = pathlib.Path(__file__).resolve().parents[3]


def audio(item):
    file = pathlib.Path(item['audio']).resolve(strict=True)
    assert file.is_relative_to(root)
    with wave.open(str(file)) as wave_file:
        assert (wave_file.getnchannels(), wave_file.getframerate(), wave_file.getsampwidth()) == (1, 16000, 2)
        data = wave_file.readframes(wave_file.getnframes())
    assert np.abs(np.frombuffer(data, dtype='<i2').astype(np.int32)).max() > 100
    return data


def quantiles(values):
    return {f'p{q}': round(float(np.percentile(values, q)), 3) for q in [50, 95, 99]} if values else {}


class Aligner:
    def __init__(self, model):
        environment = {**os.environ, 'DYLD_LIBRARY_PATH': str(repository / 'macos/native/bin/qwen')}
        self.child = subprocess.Popen([str(root / 'target/release/examples/aligner-bench'), str(root / model)],
                                      stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                      text=True, env=environment)
        self.errors = collections.deque(maxlen=10)
        threading.Thread(target=lambda: self.errors.extend(self.child.stderr), daemon=True).start()
        try:
            self.ready = self.read()
            assert self.ready['type'] == 'ready', self.ready
        except BaseException:
            self.close()
            raise
        self.latencies = []

    def read(self):
        if not select.select([self.child.stdout], [], [], 180)[0]:
            raise TimeoutError('Offline aligner response exceeded 180 seconds')
        line = self.child.stdout.readline()
        if not line:
            raise RuntimeError('Aligner exited: ' + ''.join(self.errors))
        return json.loads(line)

    def run(self, item, data, **extra):
        request = dict(id=item['id'], audio=base64.b64encode(data).decode(), text=item['reference'],
                       language='English' if item['language'] == 'en_us' else 'Chinese', **extra)
        self.child.stdin.write(json.dumps(request) + '\n')
        self.child.stdin.flush()
        response = self.read()
        assert response['id'] == item['id']
        return response

    def close(self):
        self.child.stdin.close()
        try:
            self.child.wait(timeout=10)
        except subprocess.TimeoutExpired:
            self.child.kill()
            self.child.wait()


engines = {}
differences = {'en_us': [], 'cmn_hans_cn': []}
word_counts = collections.Counter()
nonfinite = collections.Counter()
cuts = []
try:
    for name in ['baseline', 'quantized']:
        engines[name] = Aligner(name)
        print(json.dumps({'loaded': name, **engines[name].ready}), flush=True)
    first = manifest['items'][0]
    for engine in engines.values():
        engine.run(first, audio(first))  # Warm-up excluded.
    for iteration in range(args.rounds):
        for index, item in enumerate(manifest['items']):
            responses = {}
            order = ['baseline', 'quantized'] if (iteration + index) % 2 == 0 else ['quantized', 'baseline']
            data = audio(item)
            for name in order:
                responses[name] = engines[name].run(item, data)
                engines[name].latencies.append(responses[name]['elapsed_ms'])
            if iteration == 0:
                reference, candidate = (responses[name]['result']['items'] for name in ['baseline', 'quantized'])
                assert [entry['text'] for entry in reference] == [entry['text'] for entry in candidate], 'Word segmentation changed'
                word_counts[item['language']] += len(reference)
                for left, right in zip(reference, candidate):
                    for key in ['start_time', 'end_time']:
                        if not (math.isfinite(left[key]) and math.isfinite(right[key])):
                            nonfinite[item['language']] += 1
                        differences[item['language']].append(abs(left[key] - right[key]) * 1000)
            if (index + 1) % 10 == 0:
                print(json.dumps({'round': iteration + 1, 'paired_clips': index + 1,
                                  'align_ms': {name: quantiles(engine.latencies) for name, engine in engines.items()},
                                  'timestamp_difference_ms': {name: quantiles(values) for name, values in differences.items()}}), flush=True)
    for language in ['en_us', 'cmn_hans_cn']:
        items = [item for item in manifest['items'] if item['language'] == language]
        for offset in range(0, 16, 4):
            group = items[offset:offset + 4]
            # Known independent utterances; never change their original waveform.
            data = (b'\0' * 6400).join(audio(item) for item in group) + b'\0' * 32000
            item = dict(group[0], id=language + '-four-' + str(offset),
                        reference=' '.join(entry['reference'] for entry in group))
            pair = {name: engine.run(item, data, op='cut', first=group[0]['reference'])['result'] for name, engine in engines.items()}
            entry = {'language': language, 'baseline_accepted': 'cut_sample' in pair['baseline'],
                     'quantized_accepted': 'cut_sample' in pair['quantized']}
            for name in ['baseline', 'quantized']:
                if 'deferred' in pair[name]:
                    entry[name + '_deferred'] = pair[name]['deferred']
            if entry['baseline_accepted'] and entry['quantized_accepted']:
                entry['difference_ms'] = abs(pair['baseline']['cut_sample'] - pair['quantized']['cut_sample']) / 16
                for value in pair.values():
                    assert value['left'] <= value['cut_sample'] / 16000 <= value['right']
            cuts.append(entry)
            print(json.dumps({'cut_checked': entry}), flush=True)
    sentence = ('The first project improved our customer service. '
                'We tested the new system with synthetic examples. '
                'Our team reviewed the results carefully. '
                'The next release will include better search.')
    for rate in [165, 195]:
        aiff = root / f'cut-{rate}.aiff'
        wav = root / f'cut-{rate}.wav'
        subprocess.run(['/usr/bin/say', '-r', str(rate), '-o', str(aiff), sentence], check=True)
        subprocess.run(['/usr/bin/afconvert', '-f', 'WAVE', '-d', 'LEI16@16000', '-c', '1', str(aiff), str(wav)], check=True)
        item = {'id': f'synthetic-{rate}', 'audio': str(wav), 'reference': sentence, 'language': 'en_us'}
        pair = {name: engine.run(item, audio(item) + b'\0' * 32000, op='cut',
                                first='The first project improved our customer service.')['result']
                for name, engine in engines.items()}
        entry = {'language': 'en_us', 'synthetic': True, 'baseline_accepted': 'cut_sample' in pair['baseline'],
                 'quantized_accepted': 'cut_sample' in pair['quantized']}
        assert entry['baseline_accepted'], 'Synthetic cut fixture must exercise an accepted crop'
        if entry['quantized_accepted']:
            entry['difference_ms'] = abs(pair['baseline']['cut_sample'] - pair['quantized']['cut_sample']) / 16
        cuts.append(entry)
        print(json.dumps({'cut_checked': entry}), flush=True)
    timestamps = {}
    for language, values in differences.items():
        timestamps[language] = {'words': word_counts[language], **quantiles(values),
                                'max_ms': round(max(values), 3),
                                'above_160ms': sum(value > 160.00001 for value in values), 'boundaries': len(values)}
    speed = {name: {'load_ms': round(engine.ready['load_ms'], 2),
                    'align_ms': quantiles(engine.latencies)}
             for name, engine in engines.items()}
    valid_cuts = [value['difference_ms'] for value in cuts if 'difference_ms' in value]
    passed = (not any(nonfinite.values())
              and all(values['p95'] <= 80.00001 and values['above_160ms'] / values['boundaries'] <= 0.01 for values in timestamps.values())
              and sum(value['baseline_accepted'] for value in cuts) >= 4
              and all(not value['baseline_accepted'] or value['quantized_accepted'] for value in cuts)
              and np.percentile(valid_cuts, 95) <= 80.00001
              and speed['quantized']['align_ms']['p95'] <= speed['baseline']['align_ms']['p95'] * 1.1)
    print(json.dumps({'type': 'comparison', 'unique_clips': 40, 'rounds': args.rounds,
                      'audio_seconds': sum(item['duration'] for item in manifest['items']),
                      'speed': speed, 'timestamp_difference_ms': timestamps, 'cuts': cuts, 'passed': bool(passed)}, ensure_ascii=False), flush=True)
    if not passed:
        raise SystemExit(2)
finally:
    for engine in engines.values():
        engine.close()

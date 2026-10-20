"""Private offline BF16 ASR child. Rust owns all VAD/alignment/endpoint decisions."""
import base64
import json
import os
import pathlib
import queue
import socket
import sys
import threading


def denied(*_args, **_kwargs):
    raise PermissionError('The local ASR process cannot access the network')


socket.socket.connect = denied
socket.socket.connect_ex = denied
socket.create_connection = denied
commands = queue.Queue(maxsize=8)


def read_commands():
    while True:
        line = sys.stdin.buffer.readline(16 * 1024 * 1024 + 1)
        if not line:
            # Retire even if the parent disappears during a long GPU operation.
            os._exit(0)
        if len(line) > 16 * 1024 * 1024 or not line.endswith(b'\n'):
            os._exit(1)
        commands.put(line)


threading.Thread(target=read_commands, daemon=True, name='qwen-owner').start()
import mlx.core as mx
import numpy as np
from mlx_qwen3_asr.load_models import load_model
from mlx_qwen3_asr import streaming

directory = pathlib.Path(sys.argv[1]).resolve(strict=True)
if not (directory / 'config.json').is_file() or not (directory / 'model.safetensors').is_file():
    raise ValueError('Original local Qwen checkpoint required')
model, _config = load_model(str(directory), dtype=mx.bfloat16)
mx.eval(model.parameters())
if model.model.embed_tokens.weight.dtype != mx.bfloat16:
    raise ValueError('Original BF16 weights required')
states = {}


def emit(value):
    print(json.dumps(value, ensure_ascii=False, separators=(',', ':')), flush=True)


def audio(command):
    raw = base64.b64decode(command.get('audio', ''), validate=True)
    if len(raw) % 4 or len(raw) > 16000 * 121 * 4:
        raise ValueError('Invalid internal PCM')
    samples = np.frombuffer(raw, dtype='<f4').copy()
    if not np.isfinite(samples).all():
        raise ValueError('Nonfinite PCM')
    return samples


emit(dict(type='ready', dtype='bfloat16'))
while True:
    command = json.loads(commands.get())
    seq, source, op = command['seq'], command.get('source'), command.get('op')
    try:
        if source not in ['system', 'microphone']:
            raise ValueError('Invalid internal source')
        text = ''
        if op == 'start':
            chunk = command['chunk']
            if chunk not in [8000, 16000]:
                raise ValueError('Invalid chunk interval')
            previous = states.pop(source, None)
            language = previous.language if previous is not None else 'unknown'
            del previous
            state = streaming.init_streaming(model=str(directory), dtype=mx.bfloat16,
                chunk_size_sec=chunk / 16000, max_context_sec=121, max_new_tokens=32,
                unfixed_chunk_num=2, unfixed_token_num=5, reuse_window_prefix=True,
                commit_at_silence=False)
            # Rebuild all encoder/decoder state from retained LIVE audio after
            # Rust accepts a safe aligned cut; do not carry old token caches.
            state.audio_accum = audio(command)
            text = command.get('text', '')
            if len(state.audio_accum) and text and language != 'unknown':
                # Re-tokenize only the retained LIVE tail. No old token IDs,
                # encoder embeddings or KV tensors survive the aligned cut.
                # The normal five-token UTF-8-safe rollback remains active.
                _model, tokenizer, _dtype = streaming._ensure_stream_runtime(state, model)
                state._window_raw_ids = tokenizer.encode(f'language {language}<asr_text>{text}')
                state._window_chunk_id = state.unfixed_chunk_num
                state.chunk_id = state.unfixed_chunk_num
                state.text = state.window_text = text
                state.language = language
            states[source] = state
        elif op in ['feed', 'finish']:
            state = states[source]
            streaming.feed_audio(audio(command), state, model=model)
            if op == 'finish':
                state.max_new_tokens = 256
                if len(state.buffer):
                    streaming.finish_streaming(state, model=model)
                elif len(state.audio_accum):
                    streaming._decode_and_update(state, model=model)
                del states[source]
            text = state.text
        elif op == 'reset':
            states.pop(source, None)
        else:
            raise ValueError('Invalid internal operation')
        emit(dict(type='ack', seq=seq, text=text))
    except Exception:
        emit(dict(type='error', seq=seq))
        raise

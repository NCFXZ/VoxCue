mod alignment;
mod engine;
mod protocol;
mod sentence;
mod vad;
use alignment::{Alignment, Completed};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use engine::{Engine, State as StreamingState};
use qwen3_asr::StreamingOptions;
use serde_json::{json, Value};
use std::sync::atomic::{AtomicU64, Ordering};
use std::{
    collections::VecDeque,
    io::{self, BufRead, Write},
    path::Path,
    time::Instant,
};
const FRAME: usize = 512;
const SAFETY: usize = 16000 * 120;
static GENERATION: AtomicU64 = AtomicU64::new(1);
fn generation() -> u64 {
    GENERATION.fetch_add(1, Ordering::Relaxed)
}
fn emit(v: Value) {
    let mut out = io::stdout().lock();
    let _ = writeln!(out, "{}", v);
    let _ = out.flush();
}
fn options(chunk: f32) -> StreamingOptions {
    StreamingOptions::default()
        .with_chunk_size_sec(chunk)
        .with_max_new_tokens_final(256)
}
struct Capture {
    id: String,
    chunk: f32,
    cursor: usize,
    base: usize,
    pending: Vec<f32>,
    ring: VecDeque<f32>,
    audio: Vec<f32>,
    state: Option<StreamingState>,
    step: u64,
    candidate: String,
    stable: usize,
    attempts: usize,
    last_attempt: usize,
    removed: usize,
    confirmed: usize,
    text: String,
    generation: u64,
    alignment_pending: Option<u64>,
}
impl Capture {
    fn new(id: String, chunk: f32) -> Self {
        Self {
            id,
            chunk,
            cursor: 0,
            base: 0,
            pending: Vec::new(),
            ring: VecDeque::new(),
            audio: Vec::new(),
            state: None,
            step: 0,
            candidate: String::new(),
            stable: 0,
            attempts: 0,
            last_attempt: 0,
            removed: 0,
            confirmed: 0,
            text: String::new(),
            generation: generation(),
            alignment_pending: None,
        }
    }
    fn clear_candidate(&mut self) {
        self.candidate.clear();
        self.stable = 0;
        self.attempts = 0;
        self.last_attempt = 0;
    }
    fn partial(&self, time: u128) {
        emit(
            json!({"type":"partial","session":self.id,"text":self.text,"step":self.step,"chunk_sec":self.chunk,"window_start_ms":(self.cursor-self.audio.len())/16,"audio_ms":self.cursor/16,"buffer_ms":self.audio.len()/16,"removed_ms":self.removed/16,"confirmed":self.confirmed,"inference_ms":time}),
        );
    }
    fn feed(
        &mut self,
        engine: &Engine,
        device: &candle_core::Device,
        aligner: &mut Alignment,
        a: &[f32],
    ) -> anyhow::Result<()> {
        self.audio.extend_from_slice(a);
        let time = Instant::now();
        let s = self
            .state
            .as_mut()
            .ok_or_else(|| anyhow::anyhow!("ASR segment missing"))?;
        let partial = engine.feed_audio(s, a)?;
        if let Some(r) = partial {
            device.synchronize()?;
            self.step += 1;
            self.text = r.text;
            self.partial(time.elapsed().as_millis());
            self.maybe_commit(aligner)?;
        }
        Ok(())
    }
    fn maybe_commit(&mut self, aligner: &mut Alignment) -> anyhow::Result<()> {
        let boundaries = sentence::ends(&self.text);
        let Some(&first_end) = boundaries.first() else {
            self.clear_candidate();
            return Ok(());
        };
        let first = self.text[..first_end].trim().to_owned();
        if first == self.candidate {
            self.stable += 1;
        } else {
            self.candidate = first.clone();
            self.stable = 1;
            self.attempts = 0;
            self.last_attempt = 0;
        }
        if boundaries.len() < 4
            || self.stable < 2
            || self.alignment_pending.is_some()
            || self.attempts >= 3
            || (self.attempts > 0 && self.cursor - self.last_attempt < 32000)
        {
            return Ok(());
        }
        self.attempts += 1;
        self.last_attempt = self.cursor;
        emit(json!({"type":"aligning","session":self.id,"buffer_ms":self.audio.len()/16}));
        self.alignment_pending = Some(aligner.submit(
            &self.id,
            self.generation,
            self.cursor - self.audio.len(),
            self.cursor,
            first,
            self.audio.clone(),
            self.text.clone(),
        ));
        Ok(())
    }
    fn aligned(&mut self, engine: &Engine, done: Completed) -> anyhow::Result<()> {
        if self.alignment_pending != Some(done.stamp.id) {
            return Ok(());
        }
        self.alignment_pending = None;
        let (cut, left, right) = match done.result {
            Ok(result) => result,
            Err(message) => {
                emit(
                    json!({"type":"alignment_deferred","session":self.id,"message":message,"alignment_ms":done.elapsed_ms}),
                );
                return Ok(());
            }
        };
        let old_start = self.cursor - self.audio.len();
        if self.state.is_none()
            || !done
                .stamp
                .accepts(self.generation, old_start, self.cursor, &self.text, cut)
        {
            emit(
                json!({"type":"alignment_deferred","session":self.id,"message":"stale alignment snapshot","alignment_ms":done.elapsed_ms}),
            );
            return Ok(());
        }
        let first_end = sentence::ends(&self.text)[0];
        let first = self.text[..first_end].trim().to_owned();
        let tail = self.text[first_end..].trim_start().to_owned();
        // Crop the LIVE buffer, never the snapshot: preserve everything received while
        // alignment ran, and rebuild all streaming state after the accepted cut.
        let retained = self.audio[cut..].to_vec();
        self.state = None;
        self.audio = retained;
        self.state = Some(engine.resume_streaming_audio(
            &self.id,
            options(self.chunk),
            &self.audio,
            &tail,
        )?);
        self.removed += cut;
        self.confirmed += 1;
        self.text = tail;
        self.clear_candidate();
        emit(
            json!({"type":"committed","session":self.id,"text":first,"tail":self.text,"reason":"four_sentences","confirmed":self.confirmed,"audio_ms":self.cursor/16,"window_start_ms":old_start/16,"cut_ms":(old_start+cut)/16,"removed_chunk_ms":cut/16,"removed_ms":self.removed/16,"buffer_ms":self.audio.len()/16,"alignment_ms":done.elapsed_ms,"alignment_snapshot_ms":done.stamp.end/16,"aligned_sentence_end_ms":(left*1000.).round(),"aligned_next_start_ms":(right*1000.).round()}),
        );
        Ok(())
    }
    fn finalize(
        &mut self,
        engine: &Engine,
        device: &candle_core::Device,
        reason: &str,
    ) -> anyhow::Result<()> {
        let start = Instant::now();
        if let Some(mut s) = self.state.take() {
            let r = engine.finish_streaming(&mut s)?;
            device.synchronize()?;
            self.text = r.text;
        }
        let n = self.audio.len();
        let window_start = self.cursor - n;
        if n > 0 {
            self.removed += n;
            if !self.text.trim().is_empty() {
                self.confirmed += 1;
            }
            emit(
                json!({"type":"tail_final","window_start_ms":window_start/16,"session":self.id,"text":self.text,"tail":"","reason":reason,"confirmed":self.confirmed,"audio_ms":self.cursor/16,"removed_chunk_ms":n/16,"removed_ms":self.removed/16,"buffer_ms":0,"inference_ms":start.elapsed().as_millis()}),
            );
        }
        self.audio = Vec::new();
        self.text.clear();
        self.clear_candidate();
        self.generation = generation();
        self.alignment_pending = None;
        Ok(())
    }
    fn frame(
        &mut self,
        engine: &Engine,
        device: &candle_core::Device,
        aligner: &mut Alignment,
        vad: &mut vad::Vad,
        a: &[f32],
    ) -> anyhow::Result<()> {
        self.cursor += a.len();
        self.ring.extend(a.iter().copied());
        while self.ring.len() > 16000 {
            self.ring.pop_front();
        }
        let decision = vad.push(a)?;
        if self.state.is_some() {
            self.feed(engine, device, aligner, a)?;
        } else if decision.kept {
            let oldest = self.cursor - self.ring.len();
            let from = (self.base + decision.start).max(oldest).min(self.cursor);
            let lead: Vec<f32> = self.ring.iter().skip(from - oldest).copied().collect();
            self.state = Some(engine.init_streaming(&self.id, options(self.chunk))?);
            emit(json!({"type":"speech_start","session":self.id,"audio_ms":self.cursor/16}));
            self.feed(engine, device, aligner, &lead)?;
        }
        if decision.ended || self.audio.len() >= SAFETY {
            let reason = if decision.ended {
                "pause"
            } else {
                "safety_limit"
            };
            self.finalize(engine, device, reason)?;
            aligner.cancel(&self.id);
            vad.reset()?;
            self.base = self.cursor;
            self.ring.clear();
        }
        Ok(())
    }
    fn audio(
        &mut self,
        engine: &Engine,
        device: &candle_core::Device,
        aligner: &mut Alignment,
        vad: &mut vad::Vad,
        a: &[f32],
    ) -> anyhow::Result<()> {
        self.pending.extend_from_slice(a);
        let n = self.pending.len() / FRAME * FRAME;
        let frames: Vec<f32> = self.pending.drain(..n).collect();
        for f in frames.chunks(FRAME) {
            self.frame(engine, device, aligner, vad, f)?;
        }
        Ok(())
    }
    fn finish(
        &mut self,
        engine: &Engine,
        device: &candle_core::Device,
        aligner: &mut Alignment,
        vad: &mut vad::Vad,
    ) -> anyhow::Result<()> {
        let tail = std::mem::take(&mut self.pending);
        if !tail.is_empty() {
            self.frame(engine, device, aligner, vad, &tail)?;
        }
        self.finalize(engine, device, "requested_stop")?;
        self.ring.clear();
        vad.reset()?;
        aligner.cancel(&self.id);
        emit(
            json!({"type":"final","session":self.id,"text":"","audio_ms":self.cursor/16,"buffer_ms":0,"removed_ms":self.removed/16,"confirmed":self.confirmed,"reason":"requested_stop"}),
        );
        Ok(())
    }
}
fn main() -> anyhow::Result<()> {
    // CUDA alignment can fall back to the CPU engine, so both Windows runtime
    // variants require this check before loading any model or starting a lane.
    #[cfg(target_os = "windows")]
    if !qwen_forced_aligner_rs::cpu_features::supported() {
        emit(json!({"type":"error","seq":null,"code":"unsupported-cpu","message":"Qwen requires AVX2 and FMA"}));
        anyhow::bail!("Qwen requires AVX2 and FMA")
    }
    if std::env::args().nth(1).as_deref() == Some("metal-check") {
        #[cfg(feature = "metal")]
        let available = candle_core::Device::new_metal(0).is_ok();
        #[cfg(not(feature = "metal"))]
        let available = false;
        emit(json!({"metal":available}));
        return Ok(());
    }
    let root = std::env::args()
        .nth(1)
        .ok_or_else(|| anyhow::anyhow!("component directory required"))?;
    let selected = std::env::args().nth(2).unwrap_or_else(|| "cuda".into());
    if !["cpu", "cuda", "metal"].contains(&selected.as_str()) {
        anyhow::bail!("unsupported inference device")
    }
    #[cfg(target_os = "macos")]
    let cpu_threads = mac_cpu_threads();
    #[cfg(target_os = "macos")]
    std::env::set_var("RAYON_NUM_THREADS", cpu_threads.to_string());
    let start = Instant::now();
    let (device, mut chunk, vram) = if selected == "cuda" {
        cuda_device()?
    } else if selected == "metal" {
        metal_device()?
    } else {
        (candle_core::Device::Cpu, 1.0, 0)
    };
    let mut use_mlx = cfg!(target_os = "macos") && selected == "metal";
    let mut resume_text = true;
    for argument in std::env::args().skip(3) {
        match argument.as_str() {
            "--chunk-ms=500" => chunk = 0.5,
            "--chunk-ms=1000" => chunk = 1.0,
            "--asr=rust" => use_mlx = false,
            "--cold-crop" => resume_text = false,
            _ => anyhow::bail!("invalid native benchmark option"),
        }
    }
    // A dedicated reader also watches the owning Node worker's pipe. If the host
    // is killed during a long CPU inference, EOF retires this process immediately.
    let (sender, receiver) = std::sync::mpsc::sync_channel::<Vec<u8>>(8);
    std::thread::spawn(move || {
        let mut input = io::stdin().lock();
        loop {
            use std::io::Read;
            let mut bytes = Vec::new();
            match (&mut input).take(20001).read_until(b'\n', &mut bytes) {
                Ok(0) => std::process::exit(0),
                Ok(count) if count <= 20000 => {
                    if sender.send(bytes).is_err() {
                        return;
                    }
                }
                _ => {
                    emit(protocol::command_error());
                    std::process::exit(1);
                }
            }
        }
    });
    let engine = Engine::load(
        &Path::new(&root).join("asr"),
        device.clone(),
        use_mlx,
        resume_text,
    )?;
    let (mut aligner, alignment_device) =
        Alignment::load(Path::new(&root).join("aligner"), selected.clone())?;
    let vad_path = if cfg!(target_os = "macos") {
        std::env::current_exe()?
            .parent()
            .unwrap()
            .join("silero-vad.gguf")
    } else {
        Path::new(&root).join("runtime/silero-vad.gguf")
    };
    emit(
        json!({"type":"ready","device":selected,"asr_backend":engine.backend(),"alignment_device":alignment_device,"async_alignment":true,"chunk_ms":(chunk*1000.)as u64,"vram_bytes":vram,"load_ms":start.elapsed().as_millis()}),
    );
    // Independent recurrent VAD/ASR states for the two existing capture sources;
    // the expensive, immutable model weights are shared by both streams.
    let mut sources = std::collections::HashMap::<String, (Capture, vad::Vad)>::new();
    loop {
        for done in aligner.poll()? {
            if let Some((capture, _)) = sources.get_mut(&done.stamp.source) {
                capture.aligned(&engine, done)?;
            }
        }
        aligner.dispatch()?;
        let bytes = match receiver.recv_timeout(std::time::Duration::from_millis(10)) {
            Ok(bytes) => bytes,
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => continue,
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
        };
        let command = match protocol::parse_command(&bytes) {
            Ok(command) => command,
            Err(()) => {
                emit(protocol::command_error());
                break;
            }
        };
        let seq = command["seq"].clone();
        let result = (|| -> anyhow::Result<()> {
            let source = command["source"].as_str().unwrap_or("");
            if !["microphone", "system"].contains(&source) {
                anyhow::bail!("invalid source")
            }
            match command["op"].as_str().unwrap_or("") {
                "start" => {
                    if sources.contains_key(source) {
                        anyhow::bail!("source already started")
                    }
                    sources.insert(
                        source.into(),
                        (
                            Capture::new(source.into(), chunk),
                            vad::Vad::new(&vad_path.to_string_lossy())?,
                        ),
                    );
                }
                "audio" => {
                    let (capture, vad) = sources
                        .get_mut(source)
                        .ok_or_else(|| anyhow::anyhow!("source missing"))?;
                    let data = STANDARD.decode(
                        command["audio"]
                            .as_str()
                            .ok_or_else(|| anyhow::anyhow!("audio missing"))?,
                    )?;
                    if data.is_empty() || data.len() % 2 != 0 || data.len() > 6400 {
                        anyhow::bail!("expected at most 200ms PCM16")
                    }
                    let samples: Vec<f32> = data
                        .chunks_exact(2)
                        .map(|x| i16::from_le_bytes([x[0], x[1]]) as f32 / 32768.)
                        .collect();
                    capture.audio(&engine, &device, &mut aligner, vad, &samples)?;
                }
                "finish" => {
                    if let Some((mut capture, mut vad)) = sources.remove(source) {
                        capture.finish(&engine, &device, &mut aligner, &mut vad)?;
                    }
                }
                "reset" => {
                    sources.remove(source);
                    aligner.cancel(source);
                    engine.reset(source)?;
                }
                _ => anyhow::bail!("unknown native operation"),
            }
            Ok(())
        })();
        match result {
            Ok(()) => emit(json!({"type":"ack","seq":seq})),
            Err(error) => {
                if std::env::var_os("VOXCUE_QWEN_DIAGNOSTICS").is_some() {
                    eprintln!("{error:#}");
                }
                emit(json!({"type":"error","seq":seq,"message":"Qwen native inference failed"}));
                break;
            }
        }
    }
    Ok(())
}

#[cfg(feature = "cuda")]
fn cuda_device() -> anyhow::Result<(candle_core::Device, f32, usize)> {
    let context = cudarc::driver::CudaContext::new(0)?;
    let bytes = context.total_mem()?;
    Ok((
        candle_core::Device::new_cuda(0)?,
        if bytes >= 4 * 1024 * 1024 * 1024 {
            0.5
        } else {
            1.0
        },
        bytes,
    ))
}
#[cfg(not(feature = "cuda"))]
fn cuda_device() -> anyhow::Result<(candle_core::Device, f32, usize)> {
    anyhow::bail!("CPU runtime does not support CUDA")
}

#[cfg(feature = "metal")]
fn metal_device() -> anyhow::Result<(candle_core::Device, f32, usize)> {
    Ok((candle_core::Device::new_metal(0)?, 0.5, 0))
}
#[cfg(not(feature = "metal"))]
fn metal_device() -> anyhow::Result<(candle_core::Device, f32, usize)> {
    anyhow::bail!("runtime does not support Metal")
}

// Size the original CPU aligner's pool from trusted performance-core inventory.
// Keep a bounded fallback, and leave the existing Windows four-thread policy.
#[cfg(target_os = "macos")]
fn mac_cpu_threads() -> usize {
    use std::ffi::{c_char, c_void};
    extern "C" {
        fn sysctlbyname(
            name: *const c_char,
            old: *mut c_void,
            size: *mut usize,
            new: *mut c_void,
            new_len: usize,
        ) -> i32;
    }
    let mut count = 0u32;
    let mut size = std::mem::size_of::<u32>();
    let status = unsafe {
        sysctlbyname(
            b"hw.perflevel0.physicalcpu\0".as_ptr().cast(),
            (&mut count as *mut u32).cast(),
            &mut size,
            std::ptr::null_mut(),
            0,
        )
    };
    if status == 0 && size == std::mem::size_of::<u32>() && count > 0 {
        (count as usize).min(6)
    } else {
        4
    }
}

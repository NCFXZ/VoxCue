//! Mac-only MLX ASR adapter. Shared Rust owns VAD, alignment and endpoints.
use base64::{engine::general_purpose::STANDARD, Engine as _};
use qwen3_asr::StreamingOptions;
use serde_json::{json, Value};
use std::{
    io::{BufRead, BufReader, Write},
    path::Path,
    process::{Child, ChildStdin, ChildStdout, Command, Stdio},
    sync::Mutex,
};

pub struct State {
    source: String,
    pending: Vec<f32>,
    chunk: usize,
}
pub struct Engine(Mutex<Process>);
impl Engine {
    pub fn load(directory: &Path, resume_text: bool) -> anyhow::Result<Self> {
        Ok(Self(Mutex::new(Process::load(directory, resume_text)?)))
    }
    pub fn resume_streaming_audio(
        &self,
        source: &str,
        options: StreamingOptions,
        samples: &[f32],
        text: &str,
    ) -> anyhow::Result<State> {
        let chunk = (options.chunk_size_sec * 16000.) as usize;
        let mut process = self
            .0
            .lock()
            .map_err(|_| anyhow::anyhow!("MLX lock poisoned"))?;
        let seed = if process.resume_text { text } else { "" };
        process.request(
            json!({"op":"start","source":source,"chunk":chunk,"audio":encode(samples),"text":seed}),
        )?;
        Ok(State {
            source: source.into(),
            pending: Vec::new(),
            chunk,
        })
    }
    pub fn feed_audio(&self, state: &mut State, samples: &[f32]) -> anyhow::Result<Option<String>> {
        state.pending.extend_from_slice(samples);
        let n = state.pending.len() / state.chunk * state.chunk;
        if n == 0 {
            return Ok(None);
        }
        let audio: Vec<f32> = state.pending.drain(..n).collect();
        let result = self
            .0
            .lock()
            .map_err(|_| anyhow::anyhow!("MLX lock poisoned"))?
            .request(json!({"op":"feed","source":state.source,"audio":encode(&audio)}))?;
        Ok(Some(text(&result)?))
    }
    pub fn finish_streaming(&self, state: &mut State) -> anyhow::Result<String> {
        let result = self
            .0
            .lock()
            .map_err(|_| anyhow::anyhow!("MLX lock poisoned"))?
            .request(json!({"op":"finish","source":state.source,"audio":encode(&state.pending)}))?;
        state.pending.clear();
        text(&result)
    }
    pub fn reset(&self, source: &str) -> anyhow::Result<()> {
        self.0
            .lock()
            .map_err(|_| anyhow::anyhow!("MLX lock poisoned"))?
            .request(json!({"op":"reset","source":source}))?;
        Ok(())
    }
}
fn text(result: &Value) -> anyhow::Result<String> {
    Ok(result["text"]
        .as_str()
        .ok_or_else(|| anyhow::anyhow!("MLX text missing"))?
        .into())
}

struct Process {
    child: Child,
    input: ChildStdin,
    output: BufReader<ChildStdout>,
    sequence: u64,
    resume_text: bool,
}
fn encode(samples: &[f32]) -> String {
    let bytes: Vec<u8> = samples
        .iter()
        .flat_map(|sample| sample.to_le_bytes())
        .collect();
    STANDARD.encode(bytes)
}
impl Process {
    fn load(directory: &Path, resume_text: bool) -> anyhow::Result<Self> {
        let runtime = std::env::current_exe()?
            .parent()
            .ok_or_else(|| anyhow::anyhow!("runtime directory missing"))?
            .to_owned();
        let mut child = Command::new(runtime.join("python/bin/python3.12"))
            .args(["-I", "-B"])
            .arg(runtime.join("mlx-worker.py"))
            .arg(directory)
            .current_dir(&runtime)
            .env_clear()
            .env("PATH", "/usr/bin:/bin:/usr/sbin:/sbin")
            .env("HF_HUB_OFFLINE", "1")
            .env("HF_HUB_DISABLE_TELEMETRY", "1")
            .env("HF_HUB_DISABLE_XET", "1")
            .env("TOKENIZERS_PARALLELISM", "false")
            .env("OPENBLAS_NUM_THREADS", "1")
            .env("OMP_NUM_THREADS", "2")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()?;
        let input = child
            .stdin
            .take()
            .ok_or_else(|| anyhow::anyhow!("MLX input missing"))?;
        let output = BufReader::new(
            child
                .stdout
                .take()
                .ok_or_else(|| anyhow::anyhow!("MLX output missing"))?,
        );
        let mut process = Self {
            child,
            input,
            output,
            sequence: 0,
            resume_text,
        };
        let ready = process.read()?;
        if ready["type"] != "ready" || ready["dtype"] != "bfloat16" {
            anyhow::bail!("MLX failed to load original BF16 model");
        }
        Ok(process)
    }
    fn read(&mut self) -> anyhow::Result<Value> {
        use std::io::Read;
        let mut line = Vec::new();
        let count = (&mut self.output)
            .take(2 * 1024 * 1024 + 1)
            .read_until(b'\n', &mut line)?;
        if count == 0 || count > 2 * 1024 * 1024 {
            anyhow::bail!("MLX exited or returned an oversized response");
        }
        let result: Value = serde_json::from_slice(&line)?;
        if result["type"] == "error" {
            anyhow::bail!("MLX inference failed");
        }
        Ok(result)
    }
    fn request(&mut self, mut message: Value) -> anyhow::Result<Value> {
        self.sequence += 1;
        message["seq"] = json!(self.sequence);
        serde_json::to_writer(&mut self.input, &message)?;
        self.input.write_all(b"\n")?;
        self.input.flush()?;
        let result = self.read()?;
        if result["type"] != "ack" || result["seq"] != self.sequence {
            anyhow::bail!("MLX protocol mismatch");
        }
        Ok(result)
    }
}
impl Drop for Process {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

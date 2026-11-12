//! Mac-only MLX ASR adapter. Shared Rust owns VAD, alignment and endpoints.
use base64::{engine::general_purpose::STANDARD, Engine as _};
use qwen3_asr::StreamingOptions;
use serde_json::{json, Value};
use std::{
    io::BufReader,
    path::Path,
    process::{Child, ChildStdin, ChildStdout, Command, Stdio},
    sync::Mutex,
    time::{Duration, Instant},
};
#[path = "pipe-deadline.rs"]
mod pipe_deadline;

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
    retired: bool,
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
        // The packaged runtime has a fixed location. Development builds do not
        // impersonate an application bundle; production never accepts a bypass.
        if let Some(native) = runtime
            .parent()
            .filter(|p| p.file_name().is_some_and(|n| n == "native"))
        {
            let status = Command::new(native.join("VoxCue.Integrity"))
                .arg(std::process::id().to_string())
                .env_clear()
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .status()?;
            if !status.success() {
                anyhow::bail!("MLX runtime integrity verification failed");
            }
        }
        let child = Command::new(runtime.join("python/bin/python3.12"))
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
        Self::from_child(child, resume_text, Duration::from_secs(180))
    }
    fn from_child(mut child: Child, resume_text: bool, timeout: Duration) -> anyhow::Result<Self> {
        // Construct the owner before fallible pipe setup, so every failure
        // takes the same kill/wait path in Drop.
        let input = child.stdin.take().expect("piped MLX stdin");
        let output = child.stdout.take().expect("piped MLX stdout");
        let mut process = Self {
            child,
            input,
            output: BufReader::new(output),
            sequence: 0,
            resume_text,
            retired: false,
        };
        pipe_deadline::nonblocking(&process.input)?;
        pipe_deadline::nonblocking(process.output.get_ref())?;
        let ready = process.read(Instant::now() + timeout)?;
        if ready["type"] != "ready" || ready["dtype"] != "bfloat16" {
            anyhow::bail!("MLX failed to load original BF16 model");
        }
        Ok(process)
    }
    fn read(&mut self, deadline: Instant) -> anyhow::Result<Value> {
        let line = pipe_deadline::read_line(&mut self.output, 2 * 1024 * 1024, deadline)?;
        let result: Value = serde_json::from_slice(&line)?;
        if result["type"] == "error" {
            anyhow::bail!("MLX inference failed");
        }
        Ok(result)
    }
    fn request(&mut self, mut message: Value) -> anyhow::Result<Value> {
        self.exchange(&mut message, Duration::from_secs(120))
    }
    fn exchange(&mut self, message: &mut Value, timeout: Duration) -> anyhow::Result<Value> {
        if self.retired {
            anyhow::bail!("MLX process has retired");
        }
        self.sequence += 1;
        message["seq"] = json!(self.sequence);
        let result = (|| {
            let deadline = Instant::now() + timeout;
            let mut bytes = serde_json::to_vec(message)?;
            bytes.push(b'\n');
            pipe_deadline::write_all(&mut self.input, &bytes, deadline)?;
            let result = self.read(deadline)?;
            if result["type"] != "ack" || result["seq"] != self.sequence {
                anyhow::bail!("MLX protocol mismatch");
            }
            Ok(result)
        })();
        if result.is_err() {
            self.retired = true;
            let _ = self.child.kill();
            let _ = self.child.wait();
        }
        result
    }
}
impl Drop for Process {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn python(body: &str) -> Child {
        Command::new("/usr/bin/python3")
            .args(["-I", "-B", "-c", body])
            .env_clear()
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .unwrap()
    }
    fn ready(body: &str) -> Process {
        Process::from_child(python(&format!(
            "import sys,json,time\nprint('{{\"type\":\"ready\",\"dtype\":\"bfloat16\"}}',flush=True)\n{body}"
        )), false, Duration::from_secs(2)).unwrap()
    }
    #[test]
    fn absent_or_invalid_ready_reaps_the_actual_child() {
        for body in [
            "import time;time.sleep(60)",
            "print('not-json',flush=True)",
            "print('{\"type\":\"ready\",\"dtype\":\"float32\"}',flush=True)",
        ] {
            let child = python(body);
            let pid = child.id();
            assert!(Process::from_child(child, false, Duration::from_millis(250)).is_err());
            assert!(!Command::new("/bin/kill")
                .args(["-0", &pid.to_string()])
                .stderr(Stdio::null())
                .status()
                .unwrap()
                .success());
        }
    }
    #[test]
    fn failed_exchanges_retire_the_session_and_reap_the_child() {
        for body in [
            "sys.stdin.readline();time.sleep(60)",
            "sys.stdin.readline();print('{',end='',flush=True);time.sleep(60)",
            "sys.stdin.readline();print('x'*(2*1024*1024+1),flush=True);time.sleep(60)",
            "sys.stdin.readline();print('not-json',flush=True);time.sleep(60)",
            "sys.stdin.readline();print('{\"type\":\"ack\",\"seq\":999}',flush=True);time.sleep(60)",
            "sys.stdin.readline();print('{\"type\":\"error\"}',flush=True);time.sleep(60)",
            "sys.stdin.readline();sys.exit(3)",
            "time.sleep(60)",
        ] {
            let mut process = ready(body);
            let started = Instant::now();
            assert!(process.exchange(&mut json!({"op":"reset","audio":"x".repeat(1024*1024)}),
                Duration::from_millis(150)).is_err());
            assert!(started.elapsed() < Duration::from_secs(2));
            assert!(process.child.try_wait().unwrap().is_some());
            assert!(process.request(json!({"op":"reset"})).unwrap_err().to_string().contains("retired"));
        }
    }
    #[test]
    fn normal_sequence_then_manual_new_process_still_works() {
        for _ in 0..2 {
            let mut process = ready("for line in sys.stdin:\n m=json.loads(line);print(json.dumps(dict(type='ack',seq=m['seq'],text='synthetic')),flush=True)");
            for _ in 0..3 {
                assert_eq!(
                    text(&process.request(json!({"op":"reset"})).unwrap()).unwrap(),
                    "synthetic"
                );
            }
        }
    }
}

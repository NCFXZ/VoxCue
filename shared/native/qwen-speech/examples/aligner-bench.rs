//! Trusted offline benchmark: original/Q8_0 weights, same production aligner/cut.
#[path = "../src/sentence.rs"]
#[allow(dead_code)]
mod sentence;
use base64::{engine::general_purpose::STANDARD, Engine as _};
use qwen_forced_aligner_rs::{
    AlignRequest, AudioInput, DeviceRequest, ModelOptions, Qwen3ForcedAligner, TextInput,
};
use serde_json::{json, Value};
use std::{
    io::{self, BufRead, Read, Write},
    path::Path,
    time::Instant,
};
fn emit(value: Value) {
    let mut out = io::stdout().lock();
    writeln!(out, "{value}").unwrap();
    out.flush().unwrap();
}
fn main() -> anyhow::Result<()> {
    let root = std::env::args()
        .nth(1)
        .ok_or_else(|| anyhow::anyhow!("model directory required"))?;
    let device = match std::env::args().nth(2).as_deref().unwrap_or("cpu") {
        "cpu" => DeviceRequest::Cpu,
        #[cfg(feature = "cuda")]
        "cuda" => DeviceRequest::Cuda(0),
        _ => anyhow::bail!("expected cpu or cuda"),
    };
    std::env::set_var("RAYON_NUM_THREADS", if cfg!(target_os = "macos") { "2" } else { "4" });
    let start = Instant::now();
    let model = Qwen3ForcedAligner::load(
        Path::new(&root),
        ModelOptions {
            device,
        },
    )?;
    emit(json!({"type":"ready","load_ms":start.elapsed().as_secs_f64()*1000.}));
    let mut input = io::stdin().lock();
    loop {
        let mut line = Vec::new();
        let count = (&mut input)
            .take(12 * 1024 * 1024 + 1)
            .read_until(b'\n', &mut line)?;
        if count == 0 {
            break;
        }
        anyhow::ensure!(count <= 12 * 1024 * 1024, "benchmark input limit");
        let request: Value = serde_json::from_slice(&line)?;
        if request["op"] == "quit" {
            break;
        }
        let audio = STANDARD.decode(
            request["audio"]
                .as_str()
                .ok_or_else(|| anyhow::anyhow!("PCM missing"))?,
        )?;
        anyhow::ensure!(audio.len() % 2 == 0, "unaligned PCM16");
        let waveform: Vec<f32> = audio
            .chunks_exact(2)
            .map(|s| i16::from_le_bytes([s[0], s[1]]) as f32 / 32768.)
            .collect();
        let text = request["text"]
            .as_str()
            .ok_or_else(|| anyhow::anyhow!("text missing"))?;
        let language = request["language"].as_str().unwrap_or("English");
        let start = Instant::now();
        let result = if request["op"] == "cut" {
            let first = request["first"]
                .as_str()
                .ok_or_else(|| anyhow::anyhow!("first sentence missing"))?;
            match sentence::align_cut(&model, &waveform, text, first) {
                Ok((sample, left, right)) => json!({"cut_sample":sample,"left":left,"right":right}),
                Err(error) => json!({"deferred":error.to_string()}),
            }
        } else {
            let result = model.align(AlignRequest::new(
                AudioInput::Waveform16Khz(waveform),
                TextInput::Text(text.into()),
                language,
            ))?;
            json!({"items":result.items})
        };
        emit(
            json!({"type":"result","id":request["id"],"elapsed_ms":start.elapsed().as_secs_f64()*1000.,"result":result}),
        );
    }
    Ok(())
}

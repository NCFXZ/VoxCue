// Standalone capability inventory only: no audio, models, GPU or user data.
// Share the exact kernel precondition with the managed Qwen runtime.
#[path = "../../shared/native/qwen-speech/vendor/qwen-aligner/src/cpu_features.rs"]
mod cpu_features;

fn main() {
    println!("{{\"qwenCpu\":{}}}", cpu_features::supported());
}

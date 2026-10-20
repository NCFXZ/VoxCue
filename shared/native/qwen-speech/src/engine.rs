//! Shared Rust ASR and the compile-time platform adapter boundary.
use qwen3_asr::{AsrInference, StreamingOptions};
use std::path::Path;

// Windows never resolves or compiles the Mac-only process/protocol implementation.
#[cfg(target_os = "macos")]
#[path = "../../../../macos/native/qwen-mlx.rs"]
mod mlx;

pub enum State {
    Rust(qwen3_asr::StreamingState),
    #[cfg(target_os = "macos")]
    Mlx(mlx::State),
}
pub enum Engine {
    Rust(AsrInference),
    #[cfg(target_os = "macos")]
    Mlx(mlx::Engine),
}
pub struct Text {
    pub text: String,
}
impl Engine {
    pub fn load(
        directory: &Path,
        device: candle_core::Device,
        use_mlx: bool,
        resume_text: bool,
    ) -> anyhow::Result<Self> {
        #[cfg(target_os = "macos")]
        if use_mlx {
            return Ok(Self::Mlx(mlx::Engine::load(directory, resume_text)?));
        }
        #[cfg(not(target_os = "macos"))]
        let _ = (use_mlx, resume_text);
        Ok(Self::Rust(AsrInference::load(directory, device)?))
    }
    pub fn backend(&self) -> &'static str {
        match self {
            Self::Rust(_) => "rust",
            #[cfg(target_os = "macos")]
            Self::Mlx(_) => "mlx",
        }
    }
    pub fn init_streaming(&self, source: &str, options: StreamingOptions) -> anyhow::Result<State> {
        self.resume_streaming_audio(source, options, &[], "")
    }
    pub fn resume_streaming_audio(
        &self,
        source: &str,
        options: StreamingOptions,
        samples: &[f32],
        text: &str,
    ) -> anyhow::Result<State> {
        #[cfg(not(target_os = "macos"))]
        let _ = (source, text);
        match self {
            Self::Rust(engine) => Ok(State::Rust(engine.resume_streaming_audio(options, samples))),
            #[cfg(target_os = "macos")]
            Self::Mlx(engine) => engine
                .resume_streaming_audio(source, options, samples, text)
                .map(State::Mlx),
        }
    }
    pub fn feed_audio(&self, state: &mut State, samples: &[f32]) -> anyhow::Result<Option<Text>> {
        match (self, state) {
            (Self::Rust(engine), State::Rust(state)) => Ok(engine
                .feed_audio(state, samples)?
                .map(|result| Text { text: result.text })),
            #[cfg(target_os = "macos")]
            (Self::Mlx(engine), State::Mlx(state)) => {
                Ok(engine.feed_audio(state, samples)?.map(|text| Text { text }))
            }
            #[allow(unreachable_patterns)]
            _ => anyhow::bail!("ASR state belongs to another engine"),
        }
    }
    pub fn finish_streaming(&self, state: &mut State) -> anyhow::Result<Text> {
        match (self, state) {
            (Self::Rust(engine), State::Rust(state)) => Ok(Text {
                text: engine.finish_streaming(state)?.text,
            }),
            #[cfg(target_os = "macos")]
            (Self::Mlx(engine), State::Mlx(state)) => Ok(Text {
                text: engine.finish_streaming(state)?,
            }),
            #[allow(unreachable_patterns)]
            _ => anyhow::bail!("ASR state belongs to another engine"),
        }
    }
    pub fn reset(&self, source: &str) -> anyhow::Result<()> {
        #[cfg(target_os = "macos")]
        if let Self::Mlx(engine) = self {
            return engine.reset(source);
        }
        let _ = source;
        Ok(())
    }
}

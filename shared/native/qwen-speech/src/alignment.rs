//! One bounded, lower-priority aligner. ASR never waits for alignment results.
use qwen_forced_aligner_rs::{DeviceRequest, ModelOptions, Qwen3ForcedAligner};
use std::{
    collections::BTreeMap,
    path::PathBuf,
    sync::mpsc::{self, Receiver, SyncSender, TrySendError},
    time::Instant,
};

#[derive(Clone, Debug)]
pub struct Stamp {
    pub id: u64,
    pub source: String,
    pub generation: u64,
    pub start: usize,
    pub end: usize,
    pub first: String,
    pub guard: String,
}
impl Stamp {
    pub fn accepts(
        &self,
        generation: u64,
        start: usize,
        end: usize,
        text: &str,
        cut: usize,
    ) -> bool {
        let boundaries = crate::sentence::ends(text);
        self.generation == generation
            && self.start == start
            && self.end >= self.start
            && self.end <= end
            && cut >= 1600
            && cut
                .checked_add(8000)
                .is_some_and(|tail| tail <= self.end - self.start)
            && boundaries.len() >= 2
            && text[..boundaries[0]].trim() == self.first
            && crate::sentence::norm(&text[..boundaries[1]]) == self.guard
    }
}
struct Work {
    stamp: Stamp,
    audio: Vec<f32>,
    text: String,
}
pub struct Completed {
    pub stamp: Stamp,
    pub result: Result<(usize, f64, f64), String>,
    pub elapsed_ms: u128,
}
pub struct Alignment {
    sender: SyncSender<Work>,
    receiver: Receiver<Completed>,
    pending: BTreeMap<String, Work>,
    active: Option<u64>,
    next: u64,
    last_source: String,
}
impl Alignment {
    pub fn load(directory: PathBuf, selected: String) -> anyhow::Result<(Self, String)> {
        let (sender, jobs) = mpsc::sync_channel::<Work>(1);
        let (results, receiver) = mpsc::channel();
        let (ready, loaded) = mpsc::sync_channel(1);
        std::thread::Builder::new()
            .name("qwen-alignment".into())
            .spawn(move || {
                #[cfg(target_os = "macos")]
                let pool = match rayon::ThreadPoolBuilder::new()
                    .num_threads((crate::mac_cpu_threads() / 2).clamp(1, 3))
                    .start_handler(|_| lower_priority())
                    .build()
                {
                    Ok(pool) => pool,
                    Err(error) => {
                        let _ = ready.send(Err(error.to_string()));
                        return;
                    }
                };
                #[cfg(feature = "cuda")]
                let request = if selected == "cuda" {
                    DeviceRequest::Cuda(0)
                } else {
                    DeviceRequest::Cpu
                };
                #[cfg(not(feature = "cuda"))]
                let request = DeviceRequest::Cpu;
                let initial =
                    Qwen3ForcedAligner::load(&directory, ModelOptions { device: request });
                let (mut model, device) = match initial {
                    Ok(model) => (model, if selected == "cuda" { "cuda" } else { "cpu" }),
                    Err(_) if selected == "cuda" => match Qwen3ForcedAligner::load(
                        &directory,
                        ModelOptions {
                            device: DeviceRequest::Cpu,
                        },
                    ) {
                        Ok(model) => (model, "cpu"),
                        Err(error) => {
                            let _ = ready.send(Err(error.to_string()));
                            return;
                        }
                    },
                    Err(error) => {
                        let _ = ready.send(Err(error.to_string()));
                        return;
                    }
                };
                if ready.send(Ok(device.to_owned())).is_err() {
                    return;
                }
                for work in jobs {
                    #[cfg(target_os = "macos")]
                    let (returned, done) = pool.install(move || compute(model, work));
                    #[cfg(not(target_os = "macos"))]
                    let (returned, done) = compute(model, work);
                    model = returned;
                    if results.send(done).is_err() {
                        break;
                    }
                }
            })?;
        let device = loaded
            .recv()
            .map_err(|_| anyhow::anyhow!("alignment loader exited"))?
            .map_err(anyhow::Error::msg)?;
        Ok((
            Self {
                sender,
                receiver,
                pending: BTreeMap::new(),
                active: None,
                next: 0,
                last_source: String::new(),
            },
            device,
        ))
    }
    pub fn submit(
        &mut self,
        source: &str,
        generation: u64,
        start: usize,
        end: usize,
        first: String,
        audio: Vec<f32>,
        text: String,
    ) -> u64 {
        self.next += 1;
        let boundaries = crate::sentence::ends(&text);
        let guard = crate::sentence::norm(&text[..boundaries[1]]);
        let stamp = Stamp {
            id: self.next,
            source: source.into(),
            generation,
            start,
            end,
            first,
            guard,
        };
        self.pending
            .insert(source.into(), Work { stamp, audio, text });
        self.next
    }
    pub fn cancel(&mut self, source: &str) {
        self.pending.remove(source);
    }
    pub fn poll(&mut self) -> anyhow::Result<Vec<Completed>> {
        let mut out = Vec::new();
        loop {
            match self.receiver.try_recv() {
                Ok(done) => {
                    if self.active == Some(done.stamp.id) {
                        self.active = None;
                    }
                    out.push(done);
                }
                Err(mpsc::TryRecvError::Empty) => break,
                Err(mpsc::TryRecvError::Disconnected) => anyhow::bail!("alignment worker exited"),
            }
        }
        Ok(out)
    }
    pub fn dispatch(&mut self) -> anyhow::Result<()> {
        if self.active.is_some() {
            return Ok(());
        }
        let Some(source) = self
            .pending
            .keys()
            .find(|source| **source != self.last_source)
            .or_else(|| self.pending.keys().next())
            .cloned()
        else {
            return Ok(());
        };
        let work = self.pending.remove(&source).unwrap();
        let id = work.stamp.id;
        match self.sender.try_send(work) {
            Ok(()) => {
                self.active = Some(id);
                self.last_source = source;
            }
            Err(TrySendError::Full(work)) => {
                self.pending.insert(source, work);
            }
            Err(TrySendError::Disconnected(_)) => anyhow::bail!("alignment worker exited"),
        }
        Ok(())
    }
}
fn compute(model: Qwen3ForcedAligner, work: Work) -> (Qwen3ForcedAligner, Completed) {
    let time = Instant::now();
    let result = crate::sentence::align_cut(&model, &work.audio, &work.text, &work.stamp.first)
        .map_err(|error| error.to_string());
    (
        model,
        Completed {
            stamp: work.stamp,
            result,
            elapsed_ms: time.elapsed().as_millis(),
        },
    )
}
#[cfg(target_os = "macos")]
fn lower_priority() {
    extern "C" {
        fn pthread_set_qos_class_self_np(class: u32, relative_priority: i32) -> i32;
    }
    unsafe {
        pthread_set_qos_class_self_np(0x11, 0);
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    fn stamp() -> Stamp {
        Stamp {
            id: 1,
            source: "system".into(),
            generation: 2,
            start: 100,
            end: 40000,
            first: "First sentence.".into(),
            guard: crate::sentence::norm("First sentence. Second sentence."),
        }
    }
    #[test]
    fn retains_newer_audio_and_text() {
        let s = stamp();
        assert!(s.accepts(
            2,
            100,
            60000,
            "First sentence. Second sentence. More new text.",
            16000
        ));
    }
    fn scheduler() -> (Alignment, Receiver<Work>, mpsc::Sender<Completed>) {
        let (sender, jobs) = mpsc::sync_channel(1);
        let (results, receiver) = mpsc::channel();
        (
            Alignment {
                sender,
                receiver,
                pending: BTreeMap::new(),
                active: None,
                next: 0,
                last_source: String::new(),
            },
            jobs,
            results,
        )
    }
    fn submit(aligner: &mut Alignment, source: &str) -> u64 {
        aligner.submit(
            source,
            2,
            0,
            40000,
            "First sentence.".into(),
            vec![],
            "First sentence. Second sentence. Third sentence. Fourth sentence.".into(),
        )
    }
    #[test]
    fn busy_aligner_never_blocks_and_rotates_sources() {
        let (mut aligner, jobs, results) = scheduler();
        let first = submit(&mut aligner, "system");
        aligner.dispatch().unwrap();
        let active = jobs.try_recv().unwrap();
        assert_eq!(active.stamp.id, first);
        // Simulate an arbitrarily slow job: neither dispatch nor polling waits.
        submit(&mut aligner, "system");
        let next = submit(&mut aligner, "microphone");
        aligner.dispatch().unwrap();
        assert!(aligner.poll().unwrap().is_empty());
        assert!(matches!(jobs.try_recv(), Err(mpsc::TryRecvError::Empty)));
        results
            .send(Completed {
                stamp: active.stamp,
                result: Err("unsafe boundary".into()),
                elapsed_ms: 9000,
            })
            .unwrap();
        assert_eq!(aligner.poll().unwrap().len(), 1);
        aligner.dispatch().unwrap();
        assert_eq!(jobs.try_recv().unwrap().stamp.id, next);
    }
    #[test]
    fn pending_snapshots_are_bounded_replaced_and_cancelled() {
        let (mut aligner, jobs, _results) = scheduler();
        for _ in 0..100 {
            submit(&mut aligner, "system");
        }
        let latest = submit(&mut aligner, "system");
        submit(&mut aligner, "microphone");
        assert_eq!(aligner.pending.len(), 2);
        aligner.cancel("microphone");
        aligner.dispatch().unwrap();
        assert_eq!(jobs.try_recv().unwrap().stamp.id, latest);
        assert!(aligner.pending.is_empty());
    }
    #[test]
    fn exited_worker_is_reported_instead_of_hanging() {
        let (mut aligner, jobs, results) = scheduler();
        drop(jobs);
        submit(&mut aligner, "system");
        assert!(aligner.dispatch().is_err());
        drop(results);
        assert!(aligner.poll().is_err());
    }
    #[test]
    fn rejects_late_results_after_stop_restart_or_crop() {
        let s = stamp();
        let text = "First sentence. Second sentence. Third. Fourth.";
        assert!(!s.accepts(3, 100, 60000, text, 16000));
        assert!(!s.accepts(2, 16100, 60000, text, 16000));
        assert!(!s.accepts(2, 100, 39999, text, 16000));
    }
    #[test]
    fn revisions_near_boundary_require_fresh_alignment() {
        let s = stamp();
        assert!(!s.accepts(2, 100, 60000, "Changed first. Second sentence.", 16000));
        assert!(!s.accepts(2, 100, 60000, "First sentence. Changed second.", 16000));
        assert!(!s.accepts(2, 100, 60000, "First sentence.", 16000));
        assert!(!s.accepts(2, 100, 60000, "First sentence. Second sentence.", 35000));
    }
}

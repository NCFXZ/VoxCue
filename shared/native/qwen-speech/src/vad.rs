use std::{
    ffi::{c_char, c_void, CStr, CString},
    ptr,
};
type P = *mut c_void;
pub const SILENCE_MS: i64 = 500;
extern "C" {
    fn speech_load_params_new(p: *mut P) -> i32;
    fn speech_load_params_free(p: P);
    fn speech_load_params_set_device(p: P, s: *const c_char) -> i32;
    fn speech_load_params_set_threads(p: P, n: i32) -> i32;
    fn speech_model_load(path: *const c_char, params: P, out: *mut P) -> i32;
    fn speech_model_free(p: P);
    fn speech_request_new(model: P, out: *mut P) -> i32;
    fn speech_request_free(p: P);
    fn speech_request_set_int(p: P, opt: i32, value: i64) -> i32;
    fn speech_request_set_float(p: P, opt: i32, value: f64) -> i32;
    fn speech_detection_start(request: P, rate: i32, out: *mut P) -> i32;
    fn speech_detection_free(p: P);
    fn speech_detection_push(p: P, samples: *const f32, n: usize) -> i32;
    fn speech_detection_region_count(p: P) -> usize;
    fn speech_detection_speaking(p: P, start: *mut f64, kept: *mut i32) -> i32;
    fn speech_last_error() -> *const c_char;
}
fn check(code: i32) -> anyhow::Result<()> {
    if code != 0 {
        let p = unsafe { speech_last_error() };
        let s = if p.is_null() {
            format!("status {code}")
        } else {
            unsafe { CStr::from_ptr(p) }.to_string_lossy().into_owned()
        };
        anyhow::bail!("Silero VAD: {s}")
    }
    Ok(())
}
pub struct Vad {
    model: P,
    request: P,
    detection: P,
}
pub struct Decision {
    pub kept: bool,
    pub start: usize,
    pub ended: bool,
}
impl Vad {
    pub fn new(path: &str) -> anyhow::Result<Self> {
        let mut v = Self {
            model: ptr::null_mut(),
            request: ptr::null_mut(),
            detection: ptr::null_mut(),
        };
        let mut p = ptr::null_mut();
        check(unsafe { speech_load_params_new(&mut p) })?;
        let result = (|| -> anyhow::Result<()> {
            let cpu = CString::new("CPU")?;
            let file = CString::new(path)?;
            check(unsafe { speech_load_params_set_device(p, cpu.as_ptr()) })?;
            check(unsafe { speech_load_params_set_threads(p, 2) })?;
            check(unsafe { speech_model_load(file.as_ptr(), p, &mut v.model) })?;
            Ok(())
        })();
        unsafe { speech_load_params_free(p) };
        result?;
        check(unsafe { speech_request_new(v.model, &mut v.request) })?;
        // Silero hysteresis: start 0.5, end 0.35; allow brief words, retain 100ms leading context for all three thresholds.
        check(unsafe { speech_request_set_float(v.request, 39, 0.5) })?;
        for (opt, value) in [(40, 100), (41, SILENCE_MS), (42, 100)] {
            check(unsafe { speech_request_set_int(v.request, opt, value) })?;
        }
        v.reset()?;
        Ok(v)
    }
    pub fn reset(&mut self) -> anyhow::Result<()> {
        unsafe { speech_detection_free(self.detection) };
        self.detection = ptr::null_mut();
        check(unsafe { speech_detection_start(self.request, 16000, &mut self.detection) })
    }
    pub fn push(&mut self, a: &[f32]) -> anyhow::Result<Decision> {
        check(unsafe { speech_detection_push(self.detection, a.as_ptr(), a.len()) })?;
        let mut start = 0.;
        let mut kept = 0;
        let speaking =
            unsafe { speech_detection_speaking(self.detection, &mut start, &mut kept) } != 0;
        Ok(Decision {
            kept: speaking && kept != 0,
            start: (start * 16000.).round().max(0.) as usize,
            ended: unsafe { speech_detection_region_count(self.detection) } > 0,
        })
    }
}
impl Drop for Vad {
    fn drop(&mut self) {
        unsafe {
            speech_detection_free(self.detection);
            speech_request_free(self.request);
            speech_model_free(self.model);
        }
    }
}

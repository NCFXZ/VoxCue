mod vad;mod sentence;
use std::{collections::VecDeque,io::{self,BufRead,Write},path::Path,time::Instant};
use qwen3_asr::{AsrInference,StreamingOptions,StreamingState};
use qwen_forced_aligner_rs::{Qwen3ForcedAligner,ModelOptions,DeviceRequest};
use serde_json::{json,Value};use base64::{Engine as _,engine::general_purpose::STANDARD};
const FRAME:usize=512;const SAFETY:usize=16000*120;
fn emit(v:Value){let mut out=io::stdout().lock();let _=writeln!(out,"{}",v);let _=out.flush();}
fn options(chunk:f32)->StreamingOptions{StreamingOptions::default().with_chunk_size_sec(chunk).with_max_new_tokens_final(256)}
struct Capture{id:String,chunk:f32,cursor:usize,base:usize,pending:Vec<f32>,ring:VecDeque<f32>,audio:Vec<f32>,state:Option<StreamingState>,step:u64,candidate:String,stable:usize,attempts:usize,last_attempt:usize,removed:usize,confirmed:usize,text:String}
impl Capture{
 fn new(id:String,chunk:f32)->Self{Self{id,chunk,cursor:0,base:0,pending:Vec::new(),ring:VecDeque::new(),audio:Vec::new(),state:None,step:0,candidate:String::new(),stable:0,attempts:0,last_attempt:0,removed:0,confirmed:0,text:String::new()}}
 fn clear_candidate(&mut self){self.candidate.clear();self.stable=0;self.attempts=0;self.last_attempt=0;}
 fn partial(&self,time:u128){emit(json!({"type":"partial","session":self.id,"text":self.text,"step":self.step,"chunk_sec":self.chunk,"window_start_ms":(self.cursor-self.audio.len())/16,"audio_ms":self.cursor/16,"buffer_ms":self.audio.len()/16,"removed_ms":self.removed/16,"confirmed":self.confirmed,"inference_ms":time}));}
 fn feed(&mut self,engine:&AsrInference,device:&candle_core::Device,aligner:&Qwen3ForcedAligner,a:&[f32])->anyhow::Result<()>{
  self.audio.extend_from_slice(a);let time=Instant::now();let s=self.state.as_mut().ok_or_else(||anyhow::anyhow!("ASR segment missing"))?;
  let partial=engine.feed_audio(s,a)?;device.synchronize()?;
  if let Some(r)=partial{self.step+=1;self.text=r.text;self.partial(time.elapsed().as_millis());self.maybe_commit(engine,device,aligner)?;}Ok(())
 }
 fn maybe_commit(&mut self,engine:&AsrInference,device:&candle_core::Device,aligner:&Qwen3ForcedAligner)->anyhow::Result<()>{
  let boundaries=sentence::ends(&self.text);let Some(&first_end)=boundaries.first()else{self.clear_candidate();return Ok(())};
  let first=self.text[..first_end].trim().to_owned();
  if first==self.candidate{self.stable+=1;}else{self.candidate=first.clone();self.stable=1;self.attempts=0;self.last_attempt=0;}
  if boundaries.len()<4||self.stable<2||self.attempts>=3||(self.attempts>0&&self.cursor-self.last_attempt<32000){return Ok(())}
  self.attempts+=1;self.last_attempt=self.cursor;let start=Instant::now();
  emit(json!({"type":"aligning","session":self.id,"buffer_ms":self.audio.len()/16}));
  device.synchronize()?;let aligned=sentence::align_cut(aligner,&self.audio,&self.text,&first);
  match aligned{
   Ok((cut,left,right))=>{
    let tail=self.text[first_end..].trim_start().to_owned();
    // Allocate a new vector and drop the complete old state: committed audio and
    // its encoder/token caches are absent from all following ASR steps.
    let old_start=self.cursor-self.audio.len();let retained=self.audio[cut..].to_vec();self.state=None;self.audio=retained;
    self.state=Some(engine.resume_streaming_audio(options(self.chunk),&self.audio));
    self.removed+=cut;self.confirmed+=1;self.text=tail;self.clear_candidate();
    emit(json!({"type":"committed","session":self.id,"text":first,"tail":self.text,"reason":"four_sentences","confirmed":self.confirmed,"audio_ms":self.cursor/16,"window_start_ms":old_start/16,"cut_ms":(old_start+cut)/16,"removed_chunk_ms":cut/16,"removed_ms":self.removed/16,"buffer_ms":self.audio.len()/16,"alignment_ms":start.elapsed().as_millis(),"aligned_sentence_end_ms":(left*1000.).round(),"aligned_next_start_ms":(right*1000.).round()}));
   },
   Err(e)=>emit(json!({"type":"alignment_deferred","session":self.id,"message":e.to_string(),"alignment_ms":start.elapsed().as_millis()}))
  }Ok(())
 }
 fn finalize(&mut self,engine:&AsrInference,device:&candle_core::Device,reason:&str)->anyhow::Result<()>{
  let start=Instant::now();if let Some(mut s)=self.state.take(){let r=engine.finish_streaming(&mut s)?;device.synchronize()?;self.text=r.text;}
  let n=self.audio.len();let window_start=self.cursor-n;if n>0{self.removed+=n;if !self.text.trim().is_empty(){self.confirmed+=1;}
   emit(json!({"type":"tail_final","window_start_ms":window_start/16,"session":self.id,"text":self.text,"tail":"","reason":reason,"confirmed":self.confirmed,"audio_ms":self.cursor/16,"removed_chunk_ms":n/16,"removed_ms":self.removed/16,"buffer_ms":0,"inference_ms":start.elapsed().as_millis()}));}
  self.audio=Vec::new();self.text.clear();self.clear_candidate();Ok(())
 }
 fn frame(&mut self,engine:&AsrInference,device:&candle_core::Device,aligner:&Qwen3ForcedAligner,vad:&mut vad::Vad,a:&[f32])->anyhow::Result<()>{
  self.cursor+=a.len();self.ring.extend(a.iter().copied());while self.ring.len()>16000{self.ring.pop_front();}
  let decision=vad.push(a)?;
  if self.state.is_some(){self.feed(engine,device,aligner,a)?;}else if decision.kept{
   let oldest=self.cursor-self.ring.len();let from=(self.base+decision.start).max(oldest).min(self.cursor);
   let lead:Vec<f32>=self.ring.iter().skip(from-oldest).copied().collect();self.state=Some(engine.init_streaming(options(self.chunk)));
   emit(json!({"type":"speech_start","session":self.id,"audio_ms":self.cursor/16}));self.feed(engine,device,aligner,&lead)?;
  }
  if decision.ended||self.audio.len()>=SAFETY{let reason=if decision.ended{"pause"}else{"safety_limit"};self.finalize(engine,device,reason)?;vad.reset()?;self.base=self.cursor;self.ring.clear();}
  Ok(())
 }
 fn audio(&mut self,engine:&AsrInference,device:&candle_core::Device,aligner:&Qwen3ForcedAligner,vad:&mut vad::Vad,a:&[f32])->anyhow::Result<()>{
  self.pending.extend_from_slice(a);let n=self.pending.len()/FRAME*FRAME;let frames:Vec<f32>=self.pending.drain(..n).collect();for f in frames.chunks(FRAME){self.frame(engine,device,aligner,vad,f)?;}Ok(())
 }
 fn finish(&mut self,engine:&AsrInference,device:&candle_core::Device,aligner:&Qwen3ForcedAligner,vad:&mut vad::Vad)->anyhow::Result<()>{
  let tail=std::mem::take(&mut self.pending);if !tail.is_empty(){self.frame(engine,device,aligner,vad,&tail)?;}self.finalize(engine,device,"requested_stop")?;self.ring.clear();vad.reset()?;
  emit(json!({"type":"final","session":self.id,"text":"","audio_ms":self.cursor/16,"buffer_ms":0,"removed_ms":self.removed/16,"confirmed":self.confirmed,"reason":"requested_stop"}));Ok(())
 }
}
fn main()->anyhow::Result<()> {
 let root=std::env::args().nth(1).ok_or_else(||anyhow::anyhow!("component directory required"))?;
 let selected=std::env::args().nth(2).unwrap_or_else(||"cuda".into());
 if !["cpu","cuda"].contains(&selected.as_str()){anyhow::bail!("unsupported inference device")}
 let start=Instant::now();
 let (device,chunk,vram)=if selected=="cuda" { cuda_device()? }else{(candle_core::Device::Cpu,1.0,0)};
 let engine=AsrInference::load(&Path::new(&root).join("asr"),device.clone())?;
 #[cfg(feature="cuda")]
 let request=if selected=="cuda" {DeviceRequest::Cuda(0)}else{DeviceRequest::Cpu};
 #[cfg(not(feature="cuda"))]
 let request=DeviceRequest::Cpu;
 let (aligner,alignment_device)=match Qwen3ForcedAligner::load(&Path::new(&root).join("aligner"),ModelOptions{device:request}){
  Ok(model)=>(model,selected.as_str()),
  Err(_) if selected=="cuda" => (Qwen3ForcedAligner::load(&Path::new(&root).join("aligner"),ModelOptions{device:DeviceRequest::Cpu})?,"cpu"),
  Err(error)=>return Err(error),
 };
 let vad_path=Path::new(&root).join("runtime/silero-vad.gguf");
 emit(json!({"type":"ready","device":selected,"alignment_device":alignment_device,"chunk_ms":(chunk*1000.)as u64,"vram_bytes":vram,"load_ms":start.elapsed().as_millis()}));
 // Independent recurrent VAD/ASR states for the two existing capture sources;
 // the expensive, immutable model weights are shared by both streams.
 let mut sources=std::collections::HashMap::<String,(Capture,vad::Vad)>::new();
 // A dedicated reader also watches the owning Node worker's pipe. If the host
 // is killed during a long CPU inference, EOF retires this process immediately.
 let (sender,receiver)=std::sync::mpsc::sync_channel::<Vec<u8>>(8);
 std::thread::spawn(move || {
  let mut input=io::stdin().lock();
  loop {
   use std::io::Read;
   let mut bytes=Vec::new();
   match (&mut input).take(20001).read_until(b'\n',&mut bytes) {
    Ok(0)=>std::process::exit(0),
    Ok(count) if count<=20000=>{if sender.send(bytes).is_err(){return}},
    _=>std::process::exit(1),
   }
  }
 });
 for bytes in receiver {
  let command:Value=serde_json::from_slice(&bytes)?;
  let seq=command["seq"].clone();
  let result=(||->anyhow::Result<()> {
   let source=command["source"].as_str().unwrap_or("");
   if !["microphone","system"].contains(&source){anyhow::bail!("invalid source")}
   match command["op"].as_str().unwrap_or("") {
    "start"=>{
     if sources.contains_key(source){anyhow::bail!("source already started")}
     sources.insert(source.into(),(Capture::new(source.into(),chunk),vad::Vad::new(&vad_path.to_string_lossy())?));
    },
    "audio"=>{
     let (capture,vad)=sources.get_mut(source).ok_or_else(||anyhow::anyhow!("source missing"))?;
     let data=STANDARD.decode(command["audio"].as_str().ok_or_else(||anyhow::anyhow!("audio missing"))?)?;
     if data.is_empty()||data.len()%2!=0||data.len()>6400 {anyhow::bail!("expected at most 200ms PCM16")}
     let samples:Vec<f32>=data.chunks_exact(2).map(|x|i16::from_le_bytes([x[0],x[1]])as f32/32768.).collect();
     capture.audio(&engine,&device,&aligner,vad,&samples)?;
    },
    "finish"=>{
     if let Some((mut capture,mut vad))=sources.remove(source){
      capture.finish(&engine,&device,&aligner,&mut vad)?;
     }
    },
    "reset"=>{sources.remove(source);},
    _=>anyhow::bail!("unknown native operation")
   }
   Ok(())
  })();
  match result {
   Ok(())=>emit(json!({"type":"ack","seq":seq})),
   Err(error)=>{if std::env::var_os("VOXCUE_QWEN_DIAGNOSTICS").is_some(){eprintln!("{error:#}");}emit(json!({"type":"error","seq":seq,"message":"Qwen native inference failed"}));break},
  }
 }
 Ok(())
}

#[cfg(feature="cuda")]
fn cuda_device()->anyhow::Result<(candle_core::Device,f32,usize)>{
 let context=cudarc::driver::CudaContext::new(0)?;
 let bytes=context.total_mem()?;
 Ok((candle_core::Device::new_cuda(0)?,if bytes>=4*1024*1024*1024 {0.5}else{1.0},bytes))
}
#[cfg(not(feature="cuda"))]
fn cuda_device()->anyhow::Result<(candle_core::Device,f32,usize)>{anyhow::bail!("CPU runtime does not support CUDA")}

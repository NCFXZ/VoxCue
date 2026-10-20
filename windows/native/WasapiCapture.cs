// VoxCue: visible, explicitly started WASAPI shared-mode microphone / render loopback.
// No audio files, virtual drivers, process inspection, or capture protection changes.
using System;
using System.IO;
using System.Text;
using System.Threading;
using System.Diagnostics;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Web.Script.Serialization;

class WasapiCapture {
  static volatile bool stopping;
  static JavaScriptSerializer json = new JavaScriptSerializer();
  static Guid AudioClientId = new Guid("1CB9AD4C-DBFA-4c32-B178-C2F568A703B2");
  static Guid CaptureClientId = new Guid("C8ADBD64-E71E-48a0-A4DE-185C395CD317");
  static Guid AudioClockId = new Guid("CD63314F-3FBA-4a1b-812C-EF96358728E7");
  static void Check(int hr) { if (hr < 0) Marshal.ThrowExceptionForHR(hr); }
  static void Release(object o) { if (o != null && Marshal.IsComObject(o)) Marshal.ReleaseComObject(o); }
  static string Id(IMMDevice device) { string id; Check(device.GetId(out id)); return id; }
  static string Default(IMMDeviceEnumerator e, int flow) { IMMDevice d = null; try { Check(e.GetDefaultAudioEndpoint(flow, 0, out d)); return Id(d); } catch { return ""; } finally { Release(d); } }
  static string Name(IMMDevice d) {
    IPropertyStore store = null; PropVariant value = new PropVariant();
    try { Check(d.OpenPropertyStore(0,out store)); PropertyKey key = new PropertyKey { fmtid = new Guid("A45C254E-DF1C-4EFD-8020-67D146A850E0"), pid = 14 }; Check(store.GetValue(ref key,out value)); return value.vt == 31 ? Marshal.PtrToStringUni(value.pointer) : "Audio device"; }
    finally { PropVariantClear(ref value); Release(store); }
  }
  static void Devices(IMMDeviceEnumerator e) {
    var list = new List<object>();
    for (int flow = 0; flow <= 1; ++flow) {
      IMMDeviceCollection c = null;
      try { Check(e.EnumAudioEndpoints(flow,1,out c)); uint count; Check(c.GetCount(out count)); string def=Default(e,flow);
        for (uint i=0;i<count;++i) { IMMDevice d=null; try { Check(c.Item(i,out d)); string id=Id(d); list.Add(new { id=id, name=Name(d), source=flow==0?"system":"microphone", @default=id==def }); } finally { Release(d); } }
      } finally { Release(c); }
    }
    Console.WriteLine(json.Serialize(list));
  }
  static void Status(object status) { Console.Error.WriteLine(json.Serialize(status)); }
  // Pure packet conversion also exercised with synthetic interleaved audio.
  static void WritePacket(BinaryWriter output, WaveFormat wave, bool floating, byte[] raw, uint flags, ulong qpc, ref bool havePosition) {
    int bytesPerSample=wave.bits/8,frames=raw.Length/wave.blockAlign;
    float[] mono=new float[frames];
    for(int i=0;i<frames;++i) {
      double sum=0;
      for(int c=0;c<wave.channels;++c) {
        int p=i*wave.blockAlign+c*bytesPerSample; double v;
        if(floating) v=BitConverter.ToSingle(raw,p);
        else if(wave.bits==16) v=BitConverter.ToInt16(raw,p)/32768.0;
        else if(wave.bits==24) { int n=raw[p]|(raw[p+1]<<8)|(raw[p+2]<<16); if((n&0x800000)!=0) n|=unchecked((int)0xff000000); v=n/8388608.0; }
        else v=BitConverter.ToInt32(raw,p)/2147483648.0;
        sum+=Double.IsNaN(v)||Double.IsInfinity(v)?0:v;
      }
      mono[i]=(float)Math.Max(-1,Math.Min(1,sum/wave.channels));
    }
    // The first discontinuity has no previous captured audio to lose.
    if(!havePosition)flags&=~1u;
    havePosition=true;
    // QPC from GetBuffer is already in 100ns units, common to both processes.
    output.Write(17+mono.Length*4); output.Write((byte)1); output.Write(wave.rate); output.Write(qpc/10000.0); output.Write(flags);
    byte[] samples=new byte[mono.Length*4]; Buffer.BlockCopy(mono,0,samples,0,samples.Length); output.Write(samples); output.Flush();
  }
  static int Main(string[] args) {
    Console.OutputEncoding=new UTF8Encoding(false);
    IMMDeviceEnumerator enumerator=null;
    try {
      // Query the driver before creating any audio object. No audio permission,
      // model weights, CUDA Toolkit or NVIDIA runtime DLLs are needed here.
      if(args.Length==1 && args[0]=="cuda-check") { Console.WriteLine(json.Serialize(CudaHardware())); return 0; }
      enumerator=(IMMDeviceEnumerator)new MMDeviceEnumerator();
      if(args.Length==0 || args[0]=="devices") { Devices(enumerator); return 0; }
      if(args[0]=="check") {
        if(args.Length!=3 || (args[1]!="microphone" && args[1]!="system")) throw new ArgumentException("Invalid audio check");
        Capture(enumerator,args[1],Encoding.UTF8.GetString(Convert.FromBase64String(args[2])),true);
        return 0;
      }
      if(args.Length<1 || (args[0]!="microphone" && args[0]!="system")) throw new ArgumentException("Invalid audio source");
      string requested=args.Length>1?Encoding.UTF8.GetString(Convert.FromBase64String(args[1])):"";
      var monitor=new Thread(delegate() { try { while(Console.ReadLine()!=null) {} } finally { stopping=true; } }); monitor.IsBackground=true; monitor.Start();
      Capture(enumerator,args[0],requested);
      return 0;
    } catch(Exception ex) { Status(new { type="error", code="0x"+ex.HResult.ToString("X8"), message=ex.Message }); return 1; }
    finally { Release(enumerator); }
  }
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr LoadLibraryExW(string file,IntPtr reserved,uint flags);
  [DllImport("kernel32.dll",CharSet=CharSet.Ansi,ExactSpelling=true)] static extern IntPtr GetProcAddress(IntPtr module,string name);
  [DllImport("kernel32.dll")] static extern bool FreeLibrary(IntPtr module);
  [UnmanagedFunctionPointer(CallingConvention.Winapi)] delegate int CuInit(uint flags);
  [UnmanagedFunctionPointer(CallingConvention.Winapi)] delegate int CuDriverGetVersion(out int version);
  [UnmanagedFunctionPointer(CallingConvention.Winapi)] delegate int CuDeviceGet(out int device,int ordinal);
  [UnmanagedFunctionPointer(CallingConvention.Winapi)] delegate int CuDeviceComputeCapability(out int major,out int minor,int device);
  static T CudaFunction<T>(IntPtr module,string name) where T:class {
    IntPtr address=GetProcAddress(module,name);
    if(address==IntPtr.Zero) throw new EntryPointNotFoundException(name);
    return Marshal.GetDelegateForFunctionPointer(address,typeof(T)) as T;
  }
  static object CudaHardware() {
    IntPtr module=LoadLibraryExW(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System),"nvcuda.dll"),IntPtr.Zero,0x800);
    if(module==IntPtr.Zero) return new {cuda=false,reason="driver-unavailable"};
    try {
      int version,device,major,minor;
      int initialized=CudaFunction<CuInit>(module,"cuInit")(0);
      if(initialized==100) return new {cuda=false,reason="unsupported-gpu"};
      if(initialized!=0) return new {cuda=false,reason="driver-unavailable"};
      if(CudaFunction<CuDriverGetVersion>(module,"cuDriverGetVersion")(out version)!=0) return new {cuda=false,reason="driver-unavailable"};
      // The shipped runtime uses CUDA 12.9 PTX, which needs a compatible JIT driver.
      if(version<12090) return new {cuda=false,reason="driver-outdated"};
      // Match ordinal zero used by the shipped Rust runtime, including CUDA_VISIBLE_DEVICES.
      if(CudaFunction<CuDeviceGet>(module,"cuDeviceGet")(out device,0)!=0 ||
         CudaFunction<CuDeviceComputeCapability>(module,"cuDeviceComputeCapability")(out major,out minor,device)!=0 || major<8)
        return new {cuda=false,reason="unsupported-gpu"};
      return new {cuda=true};
    } catch { return new {cuda=false,reason="driver-unavailable"}; }
    finally { FreeLibrary(module); }
  }
  static void Capture(IMMDeviceEnumerator e,string source,string requested,bool checkOnly=false) {
    IMMDevice device=null; IAudioClient client=null; IAudioCaptureClient capture=null; IAudioClock audioClock=null; IntPtr format=IntPtr.Zero;
    int flow=source=="system"?0:1;
    try {
      if(requested.Length==0) Check(e.GetDefaultAudioEndpoint(flow,0,out device)); else Check(e.GetDevice(requested,out device));
      string selected=Id(device); object audio; Check(device.Activate(ref AudioClientId,23,IntPtr.Zero,out audio)); client=(IAudioClient)audio;
      Check(client.GetMixFormat(out format)); var wave=(WaveFormat)Marshal.PtrToStructure(format,typeof(WaveFormat));
      bool floating=wave.tag==3 || (wave.tag==65534 && Marshal.ReadInt32(format,24)==3);
      bool pcm=wave.tag==1 || (wave.tag==65534 && Marshal.ReadInt32(format,24)==1);
      if(wave.channels<1||wave.channels>32||wave.rate<8000||wave.rate>192000||wave.blockAlign!=wave.channels*(wave.bits/8))throw new NotSupportedException("Invalid WASAPI mix format");
      if(!(floating&&wave.bits==32) && !(pcm&&(wave.bits==16||wave.bits==24||wave.bits==32))) throw new NotSupportedException("Unsupported WASAPI sample format");
      // AUDCLNT_STREAMFLAGS_LOOPBACK on a render endpoint is true system playback capture.
      Check(client.Initialize(0,source=="system"?0x20000u:0u,1000000,0,format,IntPtr.Zero));
      object service; Check(client.GetService(ref CaptureClientId,out service)); capture=(IAudioCaptureClient)service;
      // Permission/device preflight: never Start or read an audio buffer.
      if(checkOnly) { Console.WriteLine(json.Serialize(new {ok=true})); return; }
      ulong clockFrequency=0;
      if(source=="system") {
        // Loopback can omit PCM while the render endpoint is silent. Obtain
        // evidence from the running endpoint, never extrapolate a wall timer.
        object clockService;
        if(client.GetService(ref AudioClockId,out clockService)>=0) {
          audioClock=(IAudioClock)clockService;
          if(audioClock.GetFrequency(out clockFrequency)!=0)clockFrequency=0;
        }
      }
      var silence=new LoopbackSilence(wave.rate);
      var output=new BinaryWriter(Console.OpenStandardOutput()); var clock=Stopwatch.StartNew();
      Check(client.Start()); Status(new { type="started", source=source, rate=wave.rate, channels=wave.channels, bits=wave.bits, floating=floating });
      long lastDefaultCheck=0; bool havePosition=false,stopped=false;
      while(true) {
        // Stop new capture first, then drain every already captured packet.
        // stdout closes only after this tail has reached the parent process.
        if(stopping && !stopped) { Check(client.Stop()); stopped=true; }
        if(!stopped && clock.ElapsedMilliseconds-lastDefaultCheck>1000) {
          lastDefaultCheck=clock.ElapsedMilliseconds;
          uint state; Check(device.GetState(out state)); if(state!=1) throw new InvalidOperationException("Audio device disconnected; select a device and restart");
          if(requested.Length==0 && Default(e,flow)!=selected) throw new InvalidOperationException("Default audio device changed; restart capture");
        }
        uint packet; Check(capture.GetNextPacketSize(out packet));
        while(packet>0) {
          IntPtr data; uint frames,flags; ulong position,qpc; Check(capture.GetBuffer(out data,out frames,out flags,out position,out qpc));
          try {
            if(frames>192000) throw new InvalidOperationException("Invalid WASAPI packet length");
            byte[] raw=new byte[checked((int)frames*wave.blockAlign)]; if((flags&2)==0) Marshal.Copy(data,raw,0,raw.Length);
            if(silence.Packet(qpc,frames,flags))flags|=1;
            WritePacket(output,wave,floating,raw,flags,qpc,ref havePosition);
          } finally { Check(capture.ReleaseBuffer(frames)); }
          Check(capture.GetNextPacketSize(out packet));
        }
        if(stopped) break;
        if(audioClock!=null && clockFrequency>0) {
          ulong position,clockQpc,startQpc;
          int hr=audioClock.GetPosition(out position,out clockQpc);
          // A packet may arrive while the clock query is in flight. Give real
          // PCM priority before publishing any inferred silent interval.
          Check(capture.GetNextPacketSize(out packet));
          if(packet==0) {
            int silenceFrames=silence.Poll(clockFrequency,position,clockQpc,hr==0,out startQpc);
            if(silenceFrames>0)
              WritePacket(output,wave,floating,new byte[silenceFrames*wave.blockAlign],2,startQpc,ref havePosition);
          }
        }
        Thread.Sleep(5);
      }
      Status(new {type="stopped",source=source});
    } finally { if(client!=null) try {client.Stop();} catch {} Release(audioClock); Release(capture); Release(client); Release(device); if(format!=IntPtr.Zero) Marshal.FreeCoTaskMem(format); }
  }
  [DllImport("ole32.dll")] static extern int PropVariantClear(ref PropVariant p);
  [StructLayout(LayoutKind.Sequential,Pack=2)] struct WaveFormat { public ushort tag,channels; public uint rate,bytesPerSecond; public ushort blockAlign,bits,extra; }
  [StructLayout(LayoutKind.Sequential)] struct PropertyKey { public Guid fmtid; public uint pid; }
  [StructLayout(LayoutKind.Explicit,Size=24)] struct PropVariant { [FieldOffset(0)] public ushort vt; [FieldOffset(8)] public IntPtr pointer; }
  [ComImport,Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumerator {}
  [ComImport,Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface IMMDeviceEnumerator {
    [PreserveSig] int EnumAudioEndpoints(int flow,uint mask,out IMMDeviceCollection devices);
    [PreserveSig] int GetDefaultAudioEndpoint(int flow,int role,out IMMDevice device);
    [PreserveSig] int GetDevice([MarshalAs(UnmanagedType.LPWStr)] string id,out IMMDevice device);
    [PreserveSig] int RegisterEndpointNotificationCallback(IntPtr p); [PreserveSig] int UnregisterEndpointNotificationCallback(IntPtr p);
  }
  [ComImport,Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface IMMDeviceCollection { [PreserveSig] int GetCount(out uint n); [PreserveSig] int Item(uint n,out IMMDevice d); }
  [ComImport,Guid("D666063F-1587-4E43-81F1-B948E807363F"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface IMMDevice {
    [PreserveSig] int Activate(ref Guid iid,int ctx,IntPtr p,[MarshalAs(UnmanagedType.IUnknown)] out object obj);
    [PreserveSig] int OpenPropertyStore(int access,out IPropertyStore store);
    [PreserveSig] int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id); [PreserveSig] int GetState(out uint state);
  }
  [ComImport,Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface IPropertyStore {
    [PreserveSig] int GetCount(out uint n); [PreserveSig] int GetAt(uint n,out PropertyKey k); [PreserveSig] int GetValue(ref PropertyKey k,out PropVariant v); [PreserveSig] int SetValue(ref PropertyKey k,ref PropVariant v); [PreserveSig] int Commit();
  }
  [ComImport,Guid("1CB9AD4C-DBFA-4C32-B178-C2F568A703B2"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface IAudioClient {
    [PreserveSig] int Initialize(int mode,uint flags,long duration,long periodicity,IntPtr format,IntPtr session);
    [PreserveSig] int GetBufferSize(out uint n); [PreserveSig] int GetStreamLatency(out long n); [PreserveSig] int GetCurrentPadding(out uint n); [PreserveSig] int IsFormatSupported(int mode,IntPtr format,out IntPtr closest);
    [PreserveSig] int GetMixFormat(out IntPtr format); [PreserveSig] int GetDevicePeriod(out long normal,out long min); [PreserveSig] int Start(); [PreserveSig] int Stop(); [PreserveSig] int Reset(); [PreserveSig] int SetEventHandle(IntPtr h); [PreserveSig] int GetService(ref Guid iid,[MarshalAs(UnmanagedType.IUnknown)] out object service);
  }
  [ComImport,Guid("C8ADBD64-E71E-48A0-A4DE-185C395CD317"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface IAudioCaptureClient {
    [PreserveSig] int GetBuffer(out IntPtr data,out uint frames,out uint flags,out ulong position,out ulong qpc); [PreserveSig] int ReleaseBuffer(uint frames); [PreserveSig] int GetNextPacketSize(out uint frames);
  }
  [ComImport,Guid("CD63314F-3FBA-4A1B-812C-EF96358728E7"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface IAudioClock {
    [PreserveSig] int GetFrequency(out ulong frequency);
    [PreserveSig] int GetPosition(out ulong position,out ulong qpc);
    [PreserveSig] int GetCharacteristics(out uint characteristics);
  }
}

// Pure clock accounting, exercised without COM or hardware. Keep 50ms behind
// the confirmed device position and emit at most 100ms per drained poll.
sealed class LoopbackSilence {
  readonly uint rate;
  double anchor=-1,next=-1,covered=-1,lastQpc=-1;
  ulong origin,lastPosition;
  public LoopbackSilence(uint sampleRate) {rate=sampleRate;}
  public bool Packet(ulong qpc,uint frames,uint flags) {
    if((flags&4)!=0 || qpc==0) {anchor=next=covered=lastQpc=-1;return false;}
    bool overlap=covered>=0 && qpc+10000<covered;
    next=qpc+frames*10000000.0/rate;
    covered=-1;
    if((flags&1)!=0 || overlap)anchor=-1;
    return overlap;
  }
  public int Poll(ulong frequency,ulong position,ulong qpc,bool valid,out ulong start) {
    start=0;
    if(!valid || frequency==0 || qpc==0) {anchor=next=covered=lastQpc=-1;return 0;}
    double through=anchor+(position>=origin?(position-origin)*10000000.0/frequency:0);
    if(anchor<0 || position<lastPosition || qpc<lastQpc || Math.Abs(through-qpc)>500000) {
      anchor=qpc;origin=position;lastPosition=position;lastQpc=qpc;
      // A stalled/jumping clock discards the uncertain interval, no catch-up.
      next=Math.Max(next,qpc);return 0;
    }
    lastPosition=position;lastQpc=qpc;
    if(next<0)next=qpc;
    if(through-next<1500000)return 0;
    start=(ulong)next;
    int frames=(int)(rate/10);
    next+=frames*10000000.0/rate;
    covered=next;
    return frames;
  }
}

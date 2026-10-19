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
  static void Capture(IMMDeviceEnumerator e,string source,string requested,bool checkOnly=false) {
    IMMDevice device=null; IAudioClient client=null; IAudioCaptureClient capture=null; IntPtr format=IntPtr.Zero;
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
            WritePacket(output,wave,floating,raw,flags,qpc,ref havePosition);
          } finally { Check(capture.ReleaseBuffer(frames)); }
          Check(capture.GetNextPacketSize(out packet));
        }
        if(stopped) break;
        Thread.Sleep(5);
      }
      Status(new {type="stopped",source=source});
    } finally { if(client!=null) try {client.Stop();} catch {} Release(capture); Release(client); Release(device); if(format!=IntPtr.Zero) Marshal.FreeCoTaskMem(format); }
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
}

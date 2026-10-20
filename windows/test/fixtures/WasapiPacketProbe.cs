// Calls only the production pure converter; no COM device or audio client.
using System;
using System.IO;
using System.Reflection;
class WasapiPacketProbe {
  static void Main() {
    // Real endpoint progress, frozen capture clocks, invalid QPC and jumps.
    var silence=new LoopbackSilence(48000); ulong start;
    if(silence.Poll(48000,0,10000000,true,out start)!=0)throw new Exception("Initial clock");
    if(silence.Poll(48000,9600,12000000,true,out start)!=4800 || start!=10000000)throw new Exception("Clock silence");
    if(silence.Poll(48000,9600,12000000,true,out start)!=0)throw new Exception("Frozen clock");
    if(silence.Poll(48000,9600,50000000,true,out start)!=0)throw new Exception("Wall clock is not audio");
    if(silence.Poll(48000,19200,52000000,false,out start)!=0)throw new Exception("Invalid clock");
    if(silence.Poll(48000,19200,52000000,true,out start)!=0)throw new Exception("Reanchor");
    if(silence.Poll(48000,28800,54000000,true,out start)!=4800 || start!=52000000)throw new Exception("Resume without catch-up");
    if(!silence.Packet(52000000,4800,0))throw new Exception("Late real packet needs discontinuity");
    if(silence.Packet(0,4800,4))throw new Exception("Invalid packet");
    if(silence.Poll(48000,38400,56000000,true,out start)!=0)throw new Exception("Invalid packet reanchor");
    Type type=typeof(WasapiCapture),waveType=type.GetNestedType("WaveFormat",BindingFlags.NonPublic);
    object wave=Activator.CreateInstance(waveType);
    waveType.GetField("channels").SetValue(wave,(ushort)2);
    waveType.GetField("rate").SetValue(wave,(uint)48000);
    waveType.GetField("bits").SetValue(wave,(ushort)32);
    waveType.GetField("blockAlign").SetValue(wave,(ushort)8);
    var method=type.GetMethod("WritePacket",BindingFlags.NonPublic|BindingFlags.Static);
    using(var stream=new MemoryStream())using(var writer=new BinaryWriter(stream)) {
      float[] values={0.8f,0.4f,0.1f,0.3f,float.NaN,0.2f};
      byte[] bytes=new byte[values.Length*4];Buffer.BlockCopy(values,0,bytes,0,bytes.Length);
      object[] args={writer,wave,true,bytes,(uint)1,(ulong)9876543210000,false};
      method.Invoke(null,args);
      args[4]=(uint)5;args[5]=(ulong)9876543310000;
      method.Invoke(null,args);
      Console.WriteLine(Convert.ToBase64String(stream.ToArray()));
    }
  }
}

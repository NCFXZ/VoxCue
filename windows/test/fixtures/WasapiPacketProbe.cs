// Calls only the production pure converter; no COM device or audio client.
using System;
using System.IO;
using System.Reflection;
class WasapiPacketProbe {
  static void Main() {
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

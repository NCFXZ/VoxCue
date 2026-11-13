using System;

// A guest-only device for exercising the packaged capture process lifecycle.
// It emits the helper protocol and exits on stdin EOF without opening WASAPI.
internal class SyntheticPlayback {
  private static int Main(string[] args) {
    if (args.Length == 1 && args[0] == "devices") {
      Console.WriteLine("[{\"id\":\"fixture\",\"name\":\"Synthetic playback\",\"source\":\"system\",\"default\":true}]");
      return 0;
    }
    if (args.Length != 2 || args[0] != "system" ||
        args[1] != Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes("fixture"))) return 1;
    Console.Error.WriteLine("{\"type\":\"started\"}");
    while (Console.ReadLine() != null) {}
    return 0;
  }
}

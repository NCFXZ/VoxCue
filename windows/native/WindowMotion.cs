using System;
using System.Runtime.InteropServices;

class WindowMotion {
  const int DWMWA_TRANSITIONS_FORCEDISABLED = 3;
  [DllImport("user32.dll")]
  static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint processId);
  [DllImport("dwmapi.dll")]
  static extern int DwmSetWindowAttribute(IntPtr hwnd, int attribute, ref int value, int size);

  static int Main(string[] args) {
    ulong handle;
    uint expectedOwner, owner;
    if (args.Length != 2 || !ulong.TryParse(args[0], out handle) ||
        !uint.TryParse(args[1], out expectedOwner)) return 1;
    var hwnd = new IntPtr(unchecked((long)handle));
    if (GetWindowThreadProcessId(hwnd, out owner) == 0 || owner != expectedOwner) return 1;
    int disabled = 1;
    return DwmSetWindowAttribute(hwnd, DWMWA_TRANSITIONS_FORCEDISABLED, ref disabled, sizeof(int)) < 0 ? 1 : 0;
  }
}

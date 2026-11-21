using System;
using System.Drawing;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Forms;

// The HWND is a child of the actual Electron window from creation to destruction.
// Chromium draws the surrounding dialog. It never hosts or receives the secret.
sealed class ApiKeyPrompt : Panel, IMessageFilter {
  const int WS_CHILD = 0x40000000, WS_CLIPCHILDREN = 0x02000000, WM_KEYDOWN = 0x0100;
  const int SWP_NOSIZE = 0x0001, SWP_NOMOVE = 0x0002, SWP_NOACTIVATE = 0x0010, SWP_SHOWWINDOW = 0x0040;
  const char PasswordBullet = '\u25CF';
  [StructLayout(LayoutKind.Sequential)] struct Rect { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
  [DllImport("user32.dll")] static extern IntPtr GetParent(IntPtr hwnd);
  [DllImport("user32.dll")] static extern bool GetClientRect(IntPtr hwnd, out Rect rect);
  [DllImport("user32.dll")] static extern bool SetLayeredWindowAttributes(IntPtr hwnd, uint key, byte opacity, uint flags);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern IntPtr GetWindowDpiAwarenessContext(IntPtr hwnd);
  [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
  [DllImport("user32.dll")] static extern uint GetDpiForWindow(IntPtr hwnd);
  [DllImport("user32.dll", EntryPoint = "SendMessageW")] static extern IntPtr SendFieldMessage(
    IntPtr hwnd, int message, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr hwnd, IntPtr after,
    int x, int y, int width, int height, int flags);

  readonly IntPtr parent;
  readonly uint process;
  readonly TextBox input;
  readonly Stream output = Console.OpenStandardOutput();
  readonly System.Windows.Forms.Timer monitor = new System.Windows.Forms.Timer { Interval = 250 };
  readonly int[] points = new int[5];
  bool dark, ready, complete;
  uint dpi;
  Font textFont;

  protected override CreateParams CreateParams {
    get {
      var options = base.CreateParams;
      options.Parent = parent;
      options.Style |= WS_CHILD | WS_CLIPCHILDREN;
      options.ExStyle |= 0x00080000; // WS_EX_LAYERED: an opaque surface above Chromium's acrylic content.
      return options;
    }
  }

  ApiKeyPrompt(IntPtr owner, uint pid, string label) {
    parent = owner;
    process = pid;
    input = new TextBox { PasswordChar = PasswordBullet, MaxLength = 4096, AutoSize = false,
      BorderStyle = BorderStyle.None, ImeMode = ImeMode.Disable, AccessibleName = label };
    Controls.Add(input);
    MouseDown += delegate { input.Focus(); };
    Visible = false;
    if (GetParent(Handle) != parent) throw new InvalidOperationException("Owner HWND mismatch");
    if (!SetLayeredWindowAttributes(Handle, 0, 255, 2)) throw new InvalidOperationException("Cannot compose native input");
    monitor.Tick += delegate {
      if (!OwnedBy(parent, process)) Finish(false);
      else if (dpi != 0 && dpi != GetDpiForWindow(parent)) Position();
    };
  }

  static bool OwnedBy(IntPtr handle, uint pid) {
    uint actual;
    return GetWindowThreadProcessId(handle, out actual) != 0 && actual == pid;
  }

  void Line(string message) {
    var bytes = Encoding.ASCII.GetBytes(message + "\n");
    try { output.Write(bytes, 0, bytes.Length); output.Flush(); }
    finally { Array.Clear(bytes, 0, bytes.Length); }
  }

  void Finish(bool submit) {
    if (complete) return;
    complete = true;
    try {
      if (input.IsHandleCreated) Mask(true);
      if (submit && OwnedBy(parent, process)) {
        var bytes = Encoding.UTF8.GetBytes(input.Text);
        try { Line("submit " + Convert.ToBase64String(bytes)); }
        finally { Array.Clear(bytes, 0, bytes.Length); }
      } else Line("cancel");
    } catch (IOException) { /* The owning application closed. */ }
    finally { input.Clear(); Hide(); Application.ExitThread(); }
  }

  void Mask(bool enabled) {
    input.PasswordChar = enabled ? PasswordBullet : '\0';
  }

  void FocusInput() {
    if (!Visible || GetForegroundWindow() != parent || !OwnedBy(parent, process)) return;
    // A click on Chromium's field frame can put a sibling content HWND above the edit.
    if (!SetWindowPos(Handle, IntPtr.Zero, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE))
      { Finish(false); return; }
    input.Focus();
  }

  public bool PreFilterMessage(ref Message message) {
    if (message.HWnd != input.Handle || message.Msg != WM_KEYDOWN) return false;
    var key = (Keys)message.WParam.ToInt32();
    if (key == Keys.Enter || key == Keys.Escape) { Finish(key == Keys.Enter); return true; }
    if (key != Keys.Tab) return false;
    try { Line((ModifierKeys & Keys.Shift) == Keys.Shift ? "backtab" : "tab"); }
    catch (IOException) { Finish(false); }
    return true;
  }

  void Position() {
    Rect client;
    if (!OwnedBy(parent, process) || !GetClientRect(parent, out client)) { Finish(false); return; }
    dpi = GetDpiForWindow(parent);
    double scale = dpi / 96000.0;
    int x = (int)Math.Round(points[0] * scale), y = (int)Math.Round(points[1] * scale);
    int w = (int)Math.Round(points[2] * scale), h = (int)Math.Round(points[3] * scale);
    if (x < 0 || y < 0 || w <= 0 || h <= 0 || x + w > client.Right + 1 ||
        y + h > client.Bottom + 1) { Hide(); return; }
    var background = SystemInformation.HighContrast ? SystemColors.Window :
      (dark ? Color.FromArgb(28, 32, 35) : Color.White);
    BackColor = input.BackColor = background;
    input.ForeColor = SystemInformation.HighContrast ? SystemColors.WindowText :
      (dark ? Color.FromArgb(231, 235, 237) : Color.FromArgb(37, 41, 43));
    float pixels = Math.Max(8, (float)(points[4] * scale));
    if (textFont == null || Math.Abs(textFont.Size - pixels) > 0.01) {
      var old = textFont;
      textFont = new Font("Segoe UI", pixels, FontStyle.Regular, GraphicsUnit.Pixel);
      input.Font = textFont;
      // The React field frame supplies the same inset as other app inputs.
      SendFieldMessage(input.Handle, 0x00D3, new IntPtr(3), IntPtr.Zero); // EM_SETMARGINS, both edges.
      if (old != null) old.Dispose();
    }
    var line = Math.Min(h, input.PreferredHeight + 2);
    input.SetBounds(0, (h - line) / 2, w, line);
    if (!Visible) { Bounds = new Rectangle(x, y, w, h); Show(); }
    if (!SetWindowPos(Handle, IntPtr.Zero, x, y, w, h, SWP_SHOWWINDOW | SWP_NOACTIVATE))
      { Finish(false); return; }
    // An offscreen layout while the dialog is opening has not presented an editor yet.
    if (!ready && GetForegroundWindow() == parent) input.Focus();
    ready = true;
  }

  void Command(string message) {
    if (complete) return;
    if (message == null || message == "cancel") { Finish(false); return; }
    if (message == "submit") { Finish(true); return; }
    if (message == "reveal" || message == "mask") { Mask(message == "mask"); return; }
    if (message == "focus") { FocusInput(); return; }
    var parts = message.Split(' ');
    if (parts.Length != 7 || parts[0] != "layout" || (parts[6] != "0" && parts[6] != "1"))
      { Finish(false); return; }
    for (int i = 0; i < points.Length; i++) {
      if (!int.TryParse(parts[i + 1], NumberStyles.AllowLeadingSign, CultureInfo.InvariantCulture,
          out points[i]) || Math.Abs((long)points[i]) > 100000000) { Finish(false); return; }
    }
    dark = parts[6] == "1";
    Position();
  }

  void PumpCommands() {
    var thread = new Thread(delegate() {
      try {
        for (;;) {
          var line = Console.ReadLine();
          BeginInvoke((Action<string>)Command, new object[] { line });
          if (line == null) break;
        }
      } catch (InvalidOperationException) { /* Window already destroyed. */ }
      catch (IOException) {
        try { BeginInvoke((Action)(() => Finish(false))); } catch (InvalidOperationException) {}
      }
    });
    thread.IsBackground = true;
    thread.Start();
  }

  protected override void Dispose(bool disposing) {
    if (disposing) { monitor.Dispose(); output.Dispose(); }
    base.Dispose(disposing);
    if (disposing && textFont != null) textFont.Dispose();
  }

  [STAThread]
  static int Main(string[] args) {
    ulong handle; uint pid;
    if (args.Length != 4 || !ulong.TryParse(args[0], out handle) || !uint.TryParse(args[1], out pid)
        || args[2].Length > 80 || (args[3] != "zh-CN" && args[3] != "en")) return 1;
    var owner = new IntPtr(unchecked((long)handle));
    if (!OwnedBy(owner, pid)) return 1;
    SetThreadDpiAwarenessContext(GetWindowDpiAwarenessContext(owner));
    try {
      Application.SetUnhandledExceptionMode(UnhandledExceptionMode.ThrowException);
      Application.EnableVisualStyles();
      string service = args[2].EndsWith(" API", StringComparison.OrdinalIgnoreCase) ? args[2] : args[2] + " API";
      using (var host = new ApiKeyPrompt(owner, pid, service + (args[3] == "en" ? " key" : " 密钥"))) {
        Application.AddMessageFilter(host);
        host.monitor.Start();
        host.PumpCommands();
        try { Application.Run(); }
        finally { Application.RemoveMessageFilter(host); }
      }
      return 0;
    } catch (Exception error) {
      Console.Error.WriteLine("Native field failed: " + error.GetType().Name + " " + error.HResult.ToString("X"));
      return 1;
    }
  }
}

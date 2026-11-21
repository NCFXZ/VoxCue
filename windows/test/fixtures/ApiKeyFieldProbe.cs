using System;
using System.Diagnostics;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Forms;

// Dedicated native fixture. The only window this probes is created below, and each
// edit must also belong to the exact helper process the fixture just launched.
sealed class ApiKeyFieldProbe {
  delegate bool Enumerate(IntPtr window, IntPtr state);
  [StructLayout(LayoutKind.Sequential)] struct Rect { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] struct PointXY { public int X, Y; }
  [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr h, Enumerate cb, IntPtr arg);
  [DllImport("user32.dll")] static extern bool EnumWindows(Enumerate cb, IntPtr arg);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern IntPtr GetParent(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h, IntPtr after,
    int x, int y, int w, int height, uint flags);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out Rect rect);
  [DllImport("user32.dll")] static extern bool ClientToScreen(IntPtr h, ref PointXY point);
  [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr h, int index);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder name, int length);
  [DllImport("user32.dll")] static extern bool PostMessage(IntPtr h, int msg, IntPtr w, IntPtr l);
  [DllImport("user32.dll", EntryPoint = "SendMessageW")]
  static extern IntPtr FieldMessage(IntPtr h, int msg, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
  [DllImport("user32.dll")] static extern uint GetDpiForWindow(IntPtr h);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode)]
  static extern int GetPackageFullName(IntPtr process, ref uint length, StringBuilder fullName);
  [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(PointXY point);
  [DllImport("user32.dll")] static extern IntPtr GetDC(IntPtr h);
  [DllImport("user32.dll")] static extern int ReleaseDC(IntPtr h, IntPtr dc);
  [DllImport("gdi32.dll")] static extern uint GetPixel(IntPtr dc, int x, int y);
  [DllImport("oleacc.dll")] static extern int AccessibleObjectFromWindow(IntPtr hwnd, uint objectId,
    ref Guid iid, [MarshalAs(UnmanagedType.Interface)] out object result);

  static void Check(bool ok, string why) { if (!ok) throw new Exception(why); }
  static void Wait(Func<bool> check, string action) {
    var time = Stopwatch.StartNew();
    do {
      Application.DoEvents();
      if (check()) return;
      Thread.Sleep(15);
    } while (time.ElapsedMilliseconds < 6000);
    throw new Exception("Timed out: " + action);
  }
  static string Reply(Process child) {
    var reading = child.StandardOutput.ReadLineAsync();
    Wait(() => reading.IsCompleted, "native reply");
    return reading.Result;
  }
  static IntPtr Edit(IntPtr owner, Process child) {
    IntPtr edit = IntPtr.Zero;
    EnumChildWindows(owner, delegate(IntPtr h, IntPtr unused) {
      uint pid;
      GetWindowThreadProcessId(h, out pid);
      if (pid != (uint)child.Id || !IsWindowVisible(h)) return true;
      var name = new StringBuilder(128);
      GetClassName(h, name, name.Capacity);
      if (name.ToString().IndexOf("EDIT", StringComparison.OrdinalIgnoreCase) >= 0) edit = h;
      return edit == IntPtr.Zero;
    }, IntPtr.Zero);
    return edit;
  }
  static bool Positioned(IntPtr host, IntPtr owner, int x, int y, int w, int h) {
    double dpi = GetDpiForWindow(owner) / 96.0;
    Rect rect; var origin = new PointXY();
    if (!GetWindowRect(host, out rect) || !ClientToScreen(owner, ref origin)) return false;
    return Math.Abs(rect.Left - origin.X - Math.Round(x * dpi)) <= 1 &&
      Math.Abs(rect.Top - origin.Y - Math.Round(y * dpi)) <= 1 &&
      Math.Abs(rect.Right - rect.Left - Math.Round(w * dpi)) <= 1 &&
      Math.Abs(rect.Bottom - rect.Top - Math.Round(h * dpi)) <= 1;
  }
  static void Theme(IntPtr edit, bool dark) {
    Color expected = SystemInformation.HighContrast ? SystemColors.Window :
      dark ? Color.FromArgb(28, 32, 35) : Color.White;
    uint color = (uint)(expected.R | expected.G << 8 | expected.B << 16);
    Wait(() => {
      Rect rect; if (!GetWindowRect(edit, out rect)) return false;
      int x = (rect.Right - rect.Left) / 2, y = (rect.Bottom - rect.Top) / 2;
      var point = new PointXY { X = rect.Left + x, Y = rect.Top + y };
      // Read exactly one pixel from the empty, unobscured synthetic edit, before entering text.
      if (WindowFromPoint(point) != edit) {
        SetWindowPos(GetParent(GetParent(edit)), new IntPtr(-1), 0, 0, 0, 0, 0x1 | 0x2 | 0x40);
        return false;
      }
      var dc = GetDC(edit);
      try { return GetPixel(dc, x, y) == color; }
      finally { ReleaseDC(edit, dc); }
    }, dark ? "dark password field paint" : "light password field paint");
  }
  static void BlankField(IntPtr edit) {
    Wait(() => {
      Rect rect; if (!GetWindowRect(edit, out rect)) return false;
      var dc = GetDC(edit);
      try {
        int height = rect.Bottom - rect.Top, width = rect.Right - rect.Left;
        uint background = GetPixel(dc, width - 8, height / 2);
        if (background == 0xffffffff) return false;
        // Skip the caret at the left edge and check only the empty, owned edit.
        for (int x = 5; x < width / 2; x += 3) {
          for (int y = 2; y < height - 2; y += 2) {
            if (WindowFromPoint(new PointXY { X = rect.Left + x, Y = rect.Top + y }) != edit) return false;
            if (GetPixel(dc, x, y) != background) return false;
          }
        }
        return true;
      } finally { ReleaseDC(edit, dc); }
    }, "empty field painted without a placeholder");
  }
  static string AccessibleName(IntPtr edit) {
    var iid = new Guid("618736E0-3C3D-11CF-810C-00AA00389B71");
    object value;
    Check(AccessibleObjectFromWindow(edit, 0xfffffffc, ref iid, out value) == 0, "Missing native accessibility object");
    try { return ((Accessibility.IAccessible)value).get_accName(0); }
    finally { Marshal.ReleaseComObject(value); }
  }
  static void CheckSandboxAccount() {
    using (var identity = System.Security.Principal.WindowsIdentity.GetCurrent()) {
      Check(identity.Name.EndsWith(@"\WDAGUtilityAccount", StringComparison.OrdinalIgnoreCase) &&
        String.Equals(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), @"C:\Users\WDAGUtilityAccount",
          StringComparison.OrdinalIgnoreCase), "Pasting requires the dedicated Windows Sandbox account");
    }
  }
  static string StoreIdentity(Process process) {
    uint length = 0;
    Check(GetPackageFullName(process.Handle, ref length, null) == 122 && length > 1 && length <= 128,
      "Missing Store package identity");
    var name = new StringBuilder((int)length);
    Check(GetPackageFullName(process.Handle, ref length, name) == 0, "Store identity lookup failed");
    string fullName = name.ToString();
    Check(fullName.StartsWith("NCFX.VoxCue_", StringComparison.Ordinal) &&
      fullName.EndsWith("_x64__1syhqk59eh0f0", StringComparison.Ordinal), "Unexpected Store package identity");
    return fullName;
  }
  static int CharacterX(IntPtr edit, int index) {
    var result = FieldMessage(edit, 0x00D6, (IntPtr)index, IntPtr.Zero); // EM_POSFROMCHAR
    Check(unchecked((int)result.ToInt64()) != -1, "Missing pasted character position");
    return (short)(result.ToInt64() & 0xffff);
  }
  static void CheckPasswordDots(IntPtr edit, IntPtr mask, int length) {
    Check(FieldMessage(edit, 0x00D2, IntPtr.Zero, IntPtr.Zero) == mask, "Pasted text is not masked");
    int previous = CharacterX(edit, 0), width = CharacterX(edit, 1) - previous;
    Check(width > 0, "Password dots must have visible width");
    for (int index = 1; index < length; index++) {
      int current = CharacterX(edit, index);
      Check(Math.Abs(current - previous - width) <= 1, "Pasted characters are not equally spaced dots");
      previous = current;
    }
  }
  static void PasteInSandbox(IntPtr edit, Process child) {
    // The guest launcher disables clipboard redirection and verifies its SID differs from the host.
    CheckSandboxAccount();
    var mask = FieldMessage(edit, 0x00D2, IntPtr.Zero, IntPtr.Zero); // EM_GETPASSWORDCHAR
    Check(mask == new IntPtr(0x25CF), "Paste target does not use the password dot");
    string draft = "WiWi-" + Guid.NewGuid().ToString("N").Substring(0, 8);
    try {
      Clipboard.SetText(draft, TextDataFormat.UnicodeText);
      FieldMessage(edit, 0x0302, IntPtr.Zero, IntPtr.Zero); // WM_PASTE on this helper's edit only.
      CheckPasswordDots(edit, mask, draft.Length);
    } finally { Clipboard.Clear(); }
    child.StandardInput.WriteLine("reveal");
    Wait(() => FieldMessage(edit, 0x00D2, IntPtr.Zero, IntPtr.Zero) == IntPtr.Zero, "reveal after paste");
    Check(CharacterX(edit, 1) - CharacterX(edit, 0) > CharacterX(edit, 2) - CharacterX(edit, 1) + 1,
      "Revealed wide and narrow characters must use different advances");
    child.StandardInput.WriteLine("mask");
    Wait(() => FieldMessage(edit, 0x00D2, IntPtr.Zero, IntPtr.Zero) == mask, "remask after paste");
    CheckPasswordDots(edit, mask, draft.Length);
    child.StandardInput.WriteLine("submit");
    Check(Reply(child) == "submit " + Convert.ToBase64String(Encoding.UTF8.GetBytes(draft)),
      "Validation did not receive the original pasted draft");
  }
  static void RunCase(IntPtr owner, string helper, string action) {
    string service = action == "enter" || action == "escape" ? "Synthetic API" : "Synthetic";
    string language = action == "escape" || action == "cancel" ? "zh-CN" : "en";
    var start = new ProcessStartInfo(helper, owner.ToInt64().ToString() + " " +
      Process.GetCurrentProcess().Id + " \"" + service + "\" " + language) {
      CreateNoWindow = true, UseShellExecute = false, RedirectStandardOutput = true,
      RedirectStandardInput = true, RedirectStandardError = true
    };
    using (var child = Process.Start(start)) {
      child.ErrorDataReceived += delegate(object unused, DataReceivedEventArgs e) { if (e.Data != null) Console.Error.WriteLine(e.Data); };
      child.BeginErrorReadLine();
      try {
        child.StandardInput.AutoFlush = true;
        child.StandardInput.WriteLine("layout 32000 46000 220000 32000 14000 0");
        IntPtr edit = IntPtr.Zero;
        Wait(() => {
          if (child.HasExited) throw new Exception("Native field exited before display: " + child.ExitCode);
          edit = Edit(owner, child); return edit != IntPtr.Zero;
        }, "embedded password control");
        var host = GetParent(edit);
        Check(GetParent(host) == owner && (GetWindowLong(edit,-16) & 0x20) != 0,
          "Password masking or parent HWND mismatch");
        bool topLevel = false;
        EnumWindows(delegate(IntPtr h, IntPtr unused) {
          uint pid; GetWindowThreadProcessId(h, out pid);
          if (pid == (uint)child.Id && IsWindowVisible(h)) topLevel = true;
          return !topLevel;
        }, IntPtr.Zero);
        Check(!topLevel, "Helper created a visible top-level window");
        Wait(() => Positioned(host, owner, 32, 46, 220, 32), "initial geometry");
        Check(AccessibleName(edit) == "Synthetic API " + (language == "en" ? "key" : "密钥"),
          "Incorrect service-specific accessibility name");
        if (action == "paste" || action == "store-paste") {
          if (action == "store-paste") {
            using (var self = Process.GetCurrentProcess())
              Check(StoreIdentity(self) == StoreIdentity(child), "Store helper did not inherit the owner package");
          }
          PasteInSandbox(edit, child);
        } else if (action == "enter") {
          Theme(edit, false);
          BlankField(edit);
          child.StandardInput.WriteLine("layout 45000 72000 260000 36000 14000 1");
          Wait(() => Positioned(host, owner, 45, 72, 260, 36), "updated geometry");
          Theme(edit, true);
          BlankField(edit);
          var mask = FieldMessage(edit, 0x00D2, IntPtr.Zero, IntPtr.Zero);
          Check(mask != IntPtr.Zero, "New editor exposed text by default");
          Check(FieldMessage(edit, 0x00D4, IntPtr.Zero, IntPtr.Zero) == IntPtr.Zero,
            "Unexpected native inset inside the padded application field");
          PostMessage(edit, 0x0100, (IntPtr)9, IntPtr.Zero);
          Check(Reply(child) == "tab", "Native tab traversal failed");
          child.StandardInput.WriteLine("focus");
          foreach (char c in "synthetic-only") PostMessage(edit, 0x0102, (IntPtr)(int)c, (IntPtr)1);
          child.StandardInput.WriteLine("reveal");
          Wait(() => FieldMessage(edit, 0x00D2, IntPtr.Zero, IntPtr.Zero) == IntPtr.Zero, "revealed draft");
          child.StandardInput.WriteLine("mask");
          Wait(() => FieldMessage(edit, 0x00D2, IntPtr.Zero, IntPtr.Zero) == mask, "masked draft");
          PostMessage(edit, 0x0100, (IntPtr)13, (IntPtr)1);
          var reply = Reply(child);
          Check(reply == "submit " + Convert.ToBase64String(Encoding.UTF8.GetBytes("synthetic-only")),
            "Synthetic password submission failed. Response bytes " + (reply == null ? -1 : reply.Length));
        } else {
          if (action == "escape") PostMessage(edit, 0x0100, (IntPtr)27, IntPtr.Zero);
          else child.StandardInput.WriteLine(action);
          Check(Reply(child) == (action == "submit" ? "submit " : "cancel"), "Incorrect empty/cancel reply");
        }
        Wait(() => child.HasExited, "native retirement");
        Check(child.ExitCode == 0, "Unexpected helper exit");
      } finally {
        if (!child.HasExited) { child.Kill(); child.WaitForExit(3000); }
      }
    }
  }
  [STAThread]
  static int Main(string[] args) {
    bool store = args.Length == 2 && args[1] == "--sandbox-store-paste";
    bool paste = store || (args.Length == 2 && args[1] == "--sandbox-paste");
    try {
      if (!paste && args.Length != 1) return 1;
      if (paste) CheckSandboxAccount();
      SetThreadDpiAwarenessContext(new IntPtr(-4));
      using (var owner = new Form { Text = "VoxCue synthetic input host", ClientSize = new Size(780,460),
        StartPosition = FormStartPosition.CenterScreen, TopMost = true }) {
        owner.Show(); Application.DoEvents();
        // The test executable is launched with a hidden console. Override STARTUPINFO's
        // first-show hint for the synthetic owner HWND only.
        SetWindowPos(owner.Handle, new IntPtr(-1), 0, 0, 0, 0, 0x1 | 0x2 | 0x40);
        owner.Activate();
        Check(IsWindowVisible(owner.Handle), "Synthetic owner is not visible");
        foreach (string action in paste ? new string[] { store ? "store-paste" : "paste" } : new string[] { "enter", "submit", "escape", "cancel" })
          RunCase(owner.Handle, args[0], action);
      }
      Console.WriteLine(paste ? "Isolated WM_PASTE, password dots, reveal/remask and submission passed." :
        "Embedded child HWND, blank field, bilingual accessible names, reveal/remask, theme, layout, Tab, Enter, empty submit and cancel passed.");
      return 0;
    } catch (Exception e) {
      var native = e as System.ComponentModel.Win32Exception;
      // Only our fixed assertion strings and numeric Windows errors leave the guest.
      string reason = e.GetType() == typeof(Exception) ? e.Message :
        e.GetType().Name + " HRESULT " + e.HResult.ToString("X8") + (native == null ? "" : " Win32 " + native.NativeErrorCode);
      Console.Error.WriteLine(paste ? "Paste probe: " + reason : e.Message);
      return 1;
    }
  }
}

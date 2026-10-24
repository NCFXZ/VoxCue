using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Automation;

// Operate only a common dialog owned by this fixture's exact Electron window.
public static class ImageSaveDialog {
  [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr hwnd, uint command);
  [DllImport("user32.dll")] static extern IntPtr GetLastActivePopup(IntPtr hwnd);
  delegate bool EnumWindow(IntPtr hwnd, IntPtr state);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumWindow callback, IntPtr state);
  [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr hwnd, uint flags);
  [STAThread] public static int Main(string[] args) {
    try {
      int pid = int.Parse(args[0]);
      var owner = new IntPtr(long.Parse(args[1]));
      var ownerElement = AutomationElement.FromHandle(owner);
      if (ownerElement.Current.ProcessId != pid) throw new Exception("Owner process mismatch: expected=" + pid + ", actual=" + ownerElement.Current.ProcessId);
      bool cancel = args[2] == "cancel";
      if (!cancel && !System.IO.Path.IsPathRooted(args[2])) throw new Exception("Expected absolute synthetic destination");
      AutomationElement dialog = null;
      var timer = Stopwatch.StartNew();
      while (timer.ElapsedMilliseconds < 15000 && dialog == null) {
        // Windows may broker a common picker outside the browser PID. Its
        // native owner must still be this exact synthetic window.
        var popup = GetLastActivePopup(owner);
        if (popup != owner && GetWindow(popup, 4) == owner) {
          var candidate = AutomationElement.FromHandle(popup);
          if (candidate.Current.ClassName == "#32770") dialog = candidate;
        }
        EnumWindows((handle, unused) => {
          if (handle != owner && GetAncestor(handle, 3) == owner) {
            var candidate = AutomationElement.FromHandle(handle);
            if (candidate.Current.ClassName == "#32770") dialog = candidate;
          }
          return true;
        }, IntPtr.Zero);
        var windows = AutomationElement.RootElement.FindAll(TreeScope.Children,
          new AndCondition(new PropertyCondition(AutomationElement.ProcessIdProperty, pid),
                           new PropertyCondition(AutomationElement.ClassNameProperty, "#32770")));
        foreach (AutomationElement window in windows) {
          var handle = new IntPtr(window.Current.NativeWindowHandle);
          if (GetWindow(handle, 4) == owner) { dialog = window; break; }
        }
        if (dialog == null) Thread.Sleep(50);
      }
      if (dialog == null) {
        var windows = AutomationElement.RootElement.FindAll(TreeScope.Children,
          new PropertyCondition(AutomationElement.ProcessIdProperty, pid));
        foreach (AutomationElement window in windows)
          Console.Error.WriteLine("Owned window: " + window.Current.ClassName + ", hwnd=" + window.Current.NativeWindowHandle + ", owner=" + GetWindow(new IntPtr(window.Current.NativeWindowHandle), 4));
        throw new Exception("Owned native save dialog was not found; expected owner=" + owner);
      }
      if (!cancel) {
        AutomationElement filename = null;
        timer.Restart();
        while (timer.ElapsedMilliseconds < 10000 && filename == null) {
          filename = dialog.FindFirst(TreeScope.Descendants,
            new AndCondition(new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Edit),
                             new PropertyCondition(AutomationElement.AutomationIdProperty, "1001")));
          if (filename == null) Thread.Sleep(50);
        }
        if (filename == null) {
          Console.Error.WriteLine("Owned dialog title: " + dialog.Current.Name);
          foreach (AutomationElement control in dialog.FindAll(TreeScope.Descendants,
            new OrCondition(new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Edit),new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.ComboBox))))
            Console.Error.WriteLine("Owned input: " + control.Current.ControlType.ProgrammaticName + ", id=" + control.Current.AutomationId + ", class=" + control.Current.ClassName);
          throw new Exception("Owned save filename editor was not found");
        }
        ((ValuePattern)filename.GetCurrentPattern(ValuePattern.Pattern)).SetValue(args[2]);
      }
      var button = dialog.FindFirst(TreeScope.Descendants,
        new AndCondition(new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Button),
                         new PropertyCondition(AutomationElement.AutomationIdProperty, cancel ? "2" : "1")));
      if (button == null) throw new Exception("Owned save dialog action was not found");
      ((InvokePattern)button.GetCurrentPattern(InvokePattern.Pattern)).Invoke();
      Console.WriteLine(cancel ? "canceled" : "saved");
      return 0;
    } catch (Exception error) { Console.Error.WriteLine(error.Message); return 1; }
  }
}

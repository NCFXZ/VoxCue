// One explicitly requested monitor frame, returned in memory as bounded BGRA.
// No files, continuous recording, audio, or capture-protection changes.
using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;

class Screenshot {
  [StructLayout(LayoutKind.Sequential)] struct Rect { public int left, top, right, bottom; }
  [StructLayout(LayoutKind.Sequential)] struct MonitorInfo { public int size; public Rect monitor, work; public uint flags; }
  [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr context);
  [DllImport("user32.dll")] static extern bool IsWindow(IntPtr window);
  [DllImport("user32.dll")] static extern IntPtr MonitorFromWindow(IntPtr window, uint flags);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern bool GetMonitorInfo(IntPtr monitor, ref MonitorInfo info);

  static int Main(string[] args) {
    try {
      SetProcessDpiAwarenessContext(new IntPtr(-4));
      ulong handle;
      if (args.Length != 1 || !ulong.TryParse(args[0], out handle)) throw new ArgumentException();
      var window = new IntPtr(unchecked((long)handle));
      if (!IsWindow(window)) throw new ArgumentException();
      var info = new MonitorInfo { size = Marshal.SizeOf(typeof(MonitorInfo)) };
      if (!GetMonitorInfo(MonitorFromWindow(window, 2), ref info)) throw new IOException();
      int width = info.monitor.right - info.monitor.left, height = info.monitor.bottom - info.monitor.top;
      if (width < 1 || height < 1 || width > 16384 || height > 16384 || (long)width * height > 67108864) throw new IOException();
      using (var full = new Bitmap(width, height, PixelFormat.Format32bppArgb)) {
        using (var graphics = Graphics.FromImage(full))
          graphics.CopyFromScreen(info.monitor.left, info.monitor.top, 0, 0, full.Size, CopyPixelOperation.SourceCopy);
        double ratio = Math.Min(1, 3840.0 / Math.Max(width, height));
        if (ratio == 1) { Write(full); return 0; }
        int boundedWidth = Math.Max(1, (int)Math.Round(width * ratio)), boundedHeight = Math.Max(1, (int)Math.Round(height * ratio));
        using (var bounded = new Bitmap(boundedWidth, boundedHeight, PixelFormat.Format32bppArgb)) {
          using (var graphics = Graphics.FromImage(bounded)) {
            graphics.CompositingMode = CompositingMode.SourceCopy;
            graphics.InterpolationMode = InterpolationMode.HighQualityBicubic;
            graphics.DrawImage(full, new Rectangle(0, 0, boundedWidth, boundedHeight));
          }
          Write(bounded);
        }
      }
      return 0;
    } catch { Console.Error.WriteLine("Screen capture failed"); return 1; }
  }
  static void Write(Bitmap image) {
    var data = image.LockBits(new Rectangle(0, 0, image.Width, image.Height), ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
    try {
      using (var output = new BinaryWriter(Console.OpenStandardOutput())) {
        output.Write(image.Width); output.Write(image.Height);
        byte[] row = new byte[image.Width * 4];
        for (int y = 0; y < image.Height; y++) {
          Marshal.Copy(IntPtr.Add(data.Scan0, y * data.Stride), row, 0, row.Length);
          for (int x = 3; x < row.Length; x += 4) row[x] = 255;
          output.Write(row);
        }
      }
    } finally { image.UnlockBits(data); }
  }
}

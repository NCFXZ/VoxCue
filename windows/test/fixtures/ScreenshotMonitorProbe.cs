using System;
using System.IO;

class ScreenshotMonitorProbe {
  static Screenshot.Rect Rect(int left, int top, int right, int bottom) {
    return new Screenshot.Rect { left = left, top = top, right = right, bottom = bottom };
  }
  static long Overlap(Screenshot.Rect a, Screenshot.Rect b) {
    return Math.Max(0L, (long)Math.Min(a.right, b.right) - Math.Max(a.left, b.left)) *
      Math.Max(0L, (long)Math.Min(a.bottom, b.bottom) - Math.Max(a.top, b.top));
  }
  static bool Contains(Screenshot.Rect rect, Screenshot.Point point) {
    return point.x >= rect.left && point.x < rect.right && point.y >= rect.top && point.y < rect.bottom;
  }
  static void Require(bool value) { if (!value) throw new Exception("Monitor anchor mismatch"); }
  static void Main() {
    var small = Rect(0, 0, 1920, 1080);
    var large = Rect(1920, 0, 5760, 2160);
    var canvas = Rect(-960, 24, 2880, 2184);
    Require(Overlap(canvas, large) > Overlap(canvas, small));
    Require(Contains(small, Screenshot.MonitorAnchor(canvas, 96)));
    Require(!Contains(large, Screenshot.MonitorAnchor(canvas, 96)));
    Require(Screenshot.MonitorAnchor(canvas, 144).y == 60);
    Require(Screenshot.MonitorAnchor(canvas, 192).y == 72);
    Require(Contains(Rect(-3840, -1080, 0, 1080), Screenshot.MonitorAnchor(Rect(-3840, -1056, 0, 1104), 96)));
    Require(Contains(Rect(0, -2160, 3840, 0), Screenshot.MonitorAnchor(Rect(0, -2136, 3840, 24), 96)));
    Require(Contains(small, Screenshot.MonitorAnchor(Rect(-960, -20, 2880, 2140), 96)));
    var extreme = Screenshot.MonitorAnchor(Rect(int.MinValue, int.MinValue, int.MaxValue, int.MaxValue), 96);
    Require(extreme.x == -1 && extreme.y == int.MinValue + 24);
    try { Screenshot.MonitorAnchor(Rect(1, 1, 1, 2), 96); throw new Exception("Invalid bounds accepted"); }
    catch (IOException) {}
    Console.WriteLine("PASS: native screenshot toolbar anchor selects the intended synthetic monitor across unequal, negative and vertical layouts; no screen capture.");
  }
}

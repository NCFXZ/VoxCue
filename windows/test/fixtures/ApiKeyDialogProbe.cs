using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.WindowsRuntime;
using System.Text;
using System.Threading;
using Windows.Graphics.Capture;
using Windows.Graphics.DirectX;
using Windows.Graphics.DirectX.Direct3D11;
using Windows.Graphics.Imaging;

// The caller supplies its own development Electron window and its exact spawned
// key helper. Only that window's composed frame is captured, never a monitor.
sealed class ApiKeyDialogProbe {
  [StructLayout(LayoutKind.Sequential)] struct Rect { public int L,T,R,B; public Rectangle Box { get { return Rectangle.FromLTRB(L,T,R,B); } } }
  [StructLayout(LayoutKind.Sequential)] struct GuiInfo { public int size, flags; public IntPtr active, focus, capture, menu, move, caret; public Rect area; }
  [StructLayout(LayoutKind.Explicit, Size=40)] struct Input {
    [FieldOffset(0)] public uint type; [FieldOffset(10)] public ushort scan; [FieldOffset(12)] public uint flags;
  }
  delegate bool EnumChild(IntPtr hwnd, IntPtr arg);
  [DllImport("user32")] static extern bool EnumChildWindows(IntPtr hwnd,EnumChild callback, IntPtr arg);
  [DllImport("user32")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
  [DllImport("user32",CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr hwnd,StringBuilder name,int size);
  [DllImport("user32")] static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32")] static extern IntPtr GetAncestor(IntPtr hwnd,uint flags);
  [DllImport("user32")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32")] static extern IntPtr WindowFromPoint(Point point);
  [DllImport("user32")] static extern bool GetGUIThreadInfo(uint thread,ref GuiInfo info);
  [DllImport("user32")] static extern uint SendInput(uint count,Input[] input,int size);
  [DllImport("user32")] static extern bool GetWindowRect(IntPtr hwnd,out Rect rect);
  [DllImport("user32")] static extern bool ClientToScreen(IntPtr hwnd, ref Point point);
  [DllImport("user32")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
  [DllImport("user32")] static extern bool PrintWindow(IntPtr hwnd,IntPtr dc,uint flags);
  [DllImport("user32",EntryPoint="SendMessageW")] static extern IntPtr Message(IntPtr hwnd,int msg,IntPtr w,IntPtr l);
  [DllImport("dwmapi")] static extern int DwmGetWindowAttribute(IntPtr hwnd,int attribute,out Rect rect,int size);
  [DllImport("d3d11")] static extern int D3D11CreateDevice(IntPtr adapter,int driver,IntPtr software,uint flags,IntPtr levels,uint count,uint sdk,out IntPtr device,out int level,out IntPtr context);
  [DllImport("d3d11")] static extern int CreateDirect3D11DeviceFromDXGIDevice(IntPtr dxgi,out IntPtr device);
  [ComImport, Guid("3628E81B-3CAC-4C60-B7F4-23CE0E0C3356"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface ICaptureWindow { [PreserveSig] int CreateForWindow(IntPtr hwnd,ref Guid iid,out IntPtr item); }
  [ComImport, Guid("5B0D3235-4DBA-4D44-865E-8F1D0E4FD04D"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMemoryBytes { void GetBuffer(out IntPtr bytes,out uint count); }
  const string sample="Wivi8g";
  static void Require(bool test,string label) { if (!test) throw new InvalidOperationException(label); }
  static uint Pid(IntPtr h) { uint pid;GetWindowThreadProcessId(h,out pid);return pid; }
  static Rectangle Bounds(IntPtr h) { Rect r;Require(GetWindowRect(h,out r),"Missing HWND bounds");return r.Box; }
  static IntPtr OwnedEdit(IntPtr owner,uint pid,uint helper) {
    Require(Pid(owner)==pid && GetForegroundWindow()==owner,
      "Test Electron HWND must be foreground; expected PID="+pid+", foreground PID="+Pid(GetForegroundWindow()));
    IntPtr edit=IntPtr.Zero;
    EnumChildWindows(owner,delegate(IntPtr h,IntPtr unused) {
      if (Pid(h)!=helper || !IsWindowVisible(h)) return true;
      var type=new StringBuilder(128); GetClassName(h,type,type.Capacity);
      if(type.ToString().IndexOf("EDIT",StringComparison.OrdinalIgnoreCase)<0)return true;
      Require(edit==IntPtr.Zero,"Unexpected second visible editor");edit=h;return true;
    },IntPtr.Zero);
    Require(edit!=IntPtr.Zero && GetAncestor(edit,2)==owner,"Missing visible editor from this run's helper");
    return edit;
  }
  static IDirect3DDevice Device() {
    IntPtr d3d, context, dxgi=IntPtr.Zero, wrapped=IntPtr.Zero;int level;
    int hr=D3D11CreateDevice(IntPtr.Zero,1,IntPtr.Zero,32,IntPtr.Zero,0,7,out d3d,out level,out context);
    if(hr<0)hr=D3D11CreateDevice(IntPtr.Zero,5,IntPtr.Zero,32,IntPtr.Zero,0,7,out d3d,out level,out context);
    Marshal.ThrowExceptionForHR(hr);
    try {
      var iid=new Guid("54EC77FA-1377-44E6-8C32-88FD5F44C84C");
      Marshal.ThrowExceptionForHR(Marshal.QueryInterface(d3d,ref iid,out dxgi));
      Marshal.ThrowExceptionForHR(CreateDirect3D11DeviceFromDXGIDevice(dxgi,out wrapped));
      return (IDirect3DDevice)Marshal.GetObjectForIUnknown(wrapped);
    } finally { foreach(var p in new[]{wrapped,dxgi,context,d3d})if(p!=IntPtr.Zero)Marshal.Release(p); }
  }
  static Bitmap ComposedWindow(IntPtr owner,out Rectangle bounds) {
    var factory=(ICaptureWindow)WindowsRuntimeMarshal.GetActivationFactory(typeof(GraphicsCaptureItem));
    var iid=new Guid("79C3F95B-31F7-4EC2-A464-632EF5D30760");IntPtr raw;
    Marshal.ThrowExceptionForHR(factory.CreateForWindow(owner,ref iid,out raw));
    GraphicsCaptureItem item;
    try { item=(GraphicsCaptureItem)Marshal.GetObjectForIUnknown(raw); } finally { Marshal.Release(raw); }
    using(var device=Device())
    using(var pool=Direct3D11CaptureFramePool.CreateFreeThreaded(device,DirectXPixelFormat.B8G8R8A8UIntNormalized,2,item.Size))
    using(var session=pool.CreateCaptureSession(item)) {
      session.IsCursorCaptureEnabled=false;session.StartCapture();
      var wait=Stopwatch.StartNew();
      while(wait.ElapsedMilliseconds<5000) {
        var latest=pool.TryGetNextFrame();
        if(latest==null){Thread.Sleep(16);continue;}
        // A new WGC session may first deliver a cached frame. A static dialog
        // can produce only one; keep it if the compositor adds no newer frame.
        var refresh=Stopwatch.StartNew();
        while(refresh.ElapsedMilliseconds<700) {
          var newer=pool.TryGetNextFrame();
          if(newer==null){Thread.Sleep(15);continue;}
          latest.Dispose();latest=newer;
          if(refresh.ElapsedMilliseconds>120)break;
        }
        using(var frame=latest) {
          var copying=SoftwareBitmap.CreateCopyFromSurfaceAsync(frame.Surface);
          while(copying.Status==Windows.Foundation.AsyncStatus.Started && wait.ElapsedMilliseconds<5000)Thread.Sleep(5);
          using(var bitmap=copying.GetResults()){
            Rect extended;Marshal.ThrowExceptionForHR(DwmGetWindowAttribute(owner,9,out extended,Marshal.SizeOf(typeof(Rect))));
            var size=new Size(frame.ContentSize.Width,frame.ContentSize.Height);
            bounds=extended.Box.Size==size ? extended.Box : Bounds(owner);
            Require(bounds.Size==size && size.Width==bitmap.PixelWidth && size.Height==bitmap.PixelHeight,
              "Captured HWND frame does not match its device-pixel bounds");
            var bytes=new byte[checked(size.Width*size.Height*4)];
            using(var buffer=bitmap.LockBuffer(BitmapBufferAccessMode.Read))
            using(var reference=buffer.CreateReference()){
              IntPtr data;uint capacity;((IMemoryBytes)reference).GetBuffer(out data,out capacity);
              var plane=buffer.GetPlaneDescription(0);int row=size.Width*4;
              Require(plane.StartIndex>=0 && plane.Stride>=row &&
                (long)plane.StartIndex+(long)(size.Height-1)*plane.Stride+row<=capacity,"Invalid capture stride");
              for(int y=0;y<size.Height;y++)Marshal.Copy(IntPtr.Add(data,plane.StartIndex+y*plane.Stride),bytes,y*row,row);
            }
            var image=new Bitmap(size.Width,size.Height,PixelFormat.Format32bppRgb);
            var bits=image.LockBits(new Rectangle(Point.Empty,size),ImageLockMode.WriteOnly,PixelFormat.Format32bppRgb);
            try { Marshal.Copy(bytes,0,bits.Scan0,bytes.Length); }
            finally { image.UnlockBits(bits); Array.Clear(bytes,0,bytes.Length); }
            return image;
          }
        }
      }
      throw new TimeoutException("No composed frame from the owned Electron window");
    }
  }
  static Rectangle[] Glyphs(Bitmap image,Rectangle field,Rectangle caret,bool dark) {
    var background=image.GetPixel(field.Right-7,field.Top+field.Height/2);
    Require(dark ? background.R<85 : background.R>180,"The composed editor has the wrong theme/background");
    var result=new List<Rectangle>();int start=-1,top=0,bottom=0;
    for(int x=field.Left;x<field.Right-3;x++){
      bool ink=false;
      for(int y=field.Top+1;y<field.Bottom-1;y++){
        if(caret.Contains(x,y))continue;
        var pixel=image.GetPixel(x,y);
        if(Math.Abs(pixel.R-background.R)<62)continue;
        if(start<0){start=x;top=y;bottom=y;}
        top=Math.Min(top,y);bottom=Math.Max(bottom,y);ink=true;
      }
      if(!ink && start>=0){result.Add(Rectangle.FromLTRB(start,top,x,bottom+1));start=-1;}
    }
    return result.ToArray();
  }
  static bool Dots(Rectangle[] glyphs) {
    if(glyphs.Length!=sample.Length)return false;
    var first=glyphs[0];int pitch=glyphs[1].X-first.X;
    return pitch>2 && glyphs.All(g=>g.Width>=2 && g.Height>=2 && Math.Abs(g.Width-g.Height)<=3 &&
      Math.Abs(g.Width-first.Width)<=1 && Math.Abs(g.Height-first.Height)<=1 && Math.Abs(g.Y-first.Y)<=1) &&
      glyphs.Skip(1).Select((g,i)=>Math.Abs(g.X-glyphs[i].X-pitch)).All(error=>error<=1);
  }
  static string State(IntPtr edit,bool dark) {
    var rect=Bounds(edit);
    using(var image=new Bitmap(rect.Width,rect.Height))
    using(var graphics=Graphics.FromImage(image)) {
      var dc=graphics.GetHdc();
      try { if(!PrintWindow(edit,dc,1))Message(edit,0x318,dc,new IntPtr(0xC)); }
      finally { graphics.ReleaseHdc(dc); }
      string own;
      try {
        own=string.Join(",",Glyphs(image,new Rectangle(Point.Empty,rect.Size),Rectangle.Empty,dark).Select(g=>g.Width+"x"+g.Height));
      } catch(InvalidOperationException e) { own=e.Message; }
      long selection=Message(edit,0xB0,IntPtr.Zero,IntPtr.Zero).ToInt64();
      return "native length="+Message(edit,0x0E,IntPtr.Zero,IntPtr.Zero).ToInt64()+
        ", selection="+(selection&65535)+".."+((selection>>16)&65535)+
        ", local ink="+own+", bounds="+rect;
    }
  }
  [MTAThread] static int Main(string[] args) {
    try {
      Console.OutputEncoding=new UTF8Encoding(false);
      SetThreadDpiAwarenessContext(new IntPtr(-4));
      var owner=new IntPtr(long.Parse(args[0]));uint pid=uint.Parse(args[1]),helper=uint.Parse(args[2]);
      var edit=OwnedEdit(owner,pid,helper);string op=args[3];
      var field=Bounds(edit);
      Require(WindowFromPoint(new Point(field.Left+field.Width/2,field.Top+field.Height/2))==edit,
        "Chromium or a different HWND covers the owned native edit");
      Require(WindowFromPoint(new Point(int.Parse(args[9]),int.Parse(args[10])))==edit,
        "The rendered input slot does not hit its native edit at this zoom");
      if(op=="type") {
        foreach(char ch in sample) {
          var info=new GuiInfo {size=Marshal.SizeOf(typeof(GuiInfo))};
          Require(GetForegroundWindow()==owner && GetGUIThreadInfo(0,ref info) && info.focus==edit,
            "Refusing keyboard input outside the focused native key editor");
          var keys=new[]{new Input {type=1,scan=ch,flags=4},new Input {type=1,scan=ch,flags=6}};
          Require(SendInput(2,keys,40)==2,"Synthetic keyboard input failed");
        }
        var elapsed=Stopwatch.StartNew();
        while(Message(edit,0xB0,IntPtr.Zero,IntPtr.Zero).ToInt64()!=((sample.Length<<16)|sample.Length)) {
          if(elapsed.ElapsedMilliseconds>1600)
            throw new InvalidOperationException("Native edit did not consume the six keyboard characters: "+State(edit,args[4]=="dark"));
          Thread.Sleep(20);
        }
        return 0;
      }
      Require(op=="empty" || op=="masked" || op=="revealed","Invalid visual check");
      Require((Message(edit,0xD2,IntPtr.Zero,IntPtr.Zero)!=IntPtr.Zero)==(op!="revealed"),"Unexpected native mask state");
      var origin=Point.Empty;Require(ClientToScreen(owner,ref origin),"Missing Electron client origin");
      var crop=new Rectangle(origin.X+int.Parse(args[5]),origin.Y+int.Parse(args[6]),int.Parse(args[7]),int.Parse(args[8]));
      Rectangle frame;
      using(var image=ComposedWindow(owner,out frame)){
        Require(frame.Contains(crop) && crop.Contains(field),"Dialog or native edit falls outside the captured area");
        field.Offset(-frame.X,-frame.Y);crop.Offset(-frame.X,-frame.Y);
        var caret=Rectangle.Empty;
        var info=new GuiInfo {size=Marshal.SizeOf(typeof(GuiInfo))};
        if(GetGUIThreadInfo(0,ref info) && info.caret==edit){
          var at=Point.Empty;Require(ClientToScreen(edit,ref at),"Missing edit caret origin");
          caret=info.area.Box;caret.Offset(at.X-frame.X,at.Y-frame.Y);
        }
        var glyphs=Glyphs(image,field,caret,args[4]=="dark");
        var description=string.Join(",",glyphs.Select(g=>g.Width+"x"+g.Height));
        if(op=="empty") Require(glyphs.Length==0,"Empty field contains foreground ink: "+description);
        if(op=="masked" && !Dots(glyphs))
          throw new InvalidOperationException("Expected six visible, equally spaced password dots; composed ink="+description+
            ", "+State(edit,args[4]=="dark")+", frame="+frame+", caret="+caret);
        if(op=="revealed") Require(glyphs.Length>=3 && !Dots(glyphs) && glyphs.Select(g=>g.Width).Distinct().Count()>1,
          "Revealed synthetic characters were not painted as text; ink="+description);
        if(args.Length==12) {
          Require(op=="masked" && Path.GetFileName(args[11])=="api-key-dialog-masked.png",
            "Only the masked dialog crop may be exported");
          using(var part=image.Clone(crop,PixelFormat.Format32bppRgb))
          using(var file=new FileStream(args[11],FileMode.CreateNew,FileAccess.Write,FileShare.None)) part.Save(file,ImageFormat.Png);
        }
      }
      return 0;
    } catch(Exception e) {Console.Error.WriteLine(e.Message);return 1;}
  }
}

using System;
using System.Collections.Generic;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Threading;
using System.Text;
using System.Web.Script.Serialization;
using System.Windows.Automation;

// This probe is compiled only into an owned temporary test directory.
class WindowProbe {
  [StructLayout(LayoutKind.Sequential)] struct Point { public int X,Y; }
  [StructLayout(LayoutKind.Sequential)] struct MouseInput { public int x,y;public uint data,flags,time;public UIntPtr extra; }
  [StructLayout(LayoutKind.Sequential)] struct KeyboardInput { public ushort key,scan;public uint flags,time;public UIntPtr extra; }
  [StructLayout(LayoutKind.Explicit)] struct InputUnion { [FieldOffset(0)]public MouseInput mouse;[FieldOffset(0)]public KeyboardInput keyboard; }
  [StructLayout(LayoutKind.Sequential)] struct Input { public uint type;public InputUnion value; }
  [DllImport("user32.dll",SetLastError=true)] static extern uint SendInput(uint count,Input[] inputs,int size);
  [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
  [DllImport("kernel32.dll")] static extern uint WTSGetActiveConsoleSessionId();
  [DllImport("user32.dll")] static extern IntPtr OpenInputDesktop(uint flags,bool inherit,uint access);
  [DllImport("user32.dll")] static extern bool CloseDesktop(IntPtr handle);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern bool GetUserObjectInformationW(IntPtr handle,int index,StringBuilder name,int bytes,out int needed);
  [DllImport("user32.dll")] static extern bool GetCursorPos(out Point point);
  [DllImport("user32.dll")] static extern bool SetCursorPos(int x,int y);
  [DllImport("user32.dll")] static extern void mouse_event(uint flags,uint x,uint y,uint data,UIntPtr extra);
  [DllImport("user32.dll")] static extern IntPtr GetWindowLongPtrW(IntPtr window,int index);
  [DllImport("user32.dll")] static extern IntPtr GetClassLongPtrW(IntPtr window,int index);
  [DllImport("user32.dll")] static extern IntPtr SendMessageW(IntPtr window,int message,IntPtr w,IntPtr l);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(Point point);
  [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr window,uint flags);
  delegate bool EnumWindowProc(IntPtr window,IntPtr data);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumWindowProc callback,IntPtr data);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window,out uint process);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetClassNameW(IntPtr window,StringBuilder name,int count);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetWindowTextW(IntPtr window,StringBuilder name,int count);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern IntPtr FindWindowW(string cls,string title);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern IntPtr LoadImageW(IntPtr instance,string name,uint type,int cx,int cy,uint flags);
  [DllImport("user32.dll")] static extern bool DestroyIcon(IntPtr icon);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern Microsoft.Win32.SafeHandles.SafeFileHandle CreateFileW(string file,uint access,uint share,IntPtr security,uint creation,uint flags,IntPtr template);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr window,int attribute,out int value,int bytes);
  static void Print(object value) { Console.WriteLine(new JavaScriptSerializer().Serialize(value)); }
  static Input Key(ushort key,ushort scan,uint flags) {return new Input{type=1,value=new InputUnion{keyboard=new KeyboardInput{key=key,scan=scan,flags=flags}}};}
  static void TypeSavePath(IntPtr dialog,string path) {
    if(GetAncestor(GetForegroundWindow(),2)!=dialog)throw new Exception("Refusing keyboard input outside owned save dialog");
    var input=new List<Input>{Key(17,0,0),Key(65,0,0),Key(65,0,2),Key(17,0,2)};
    foreach(char c in path){input.Add(Key(0,c,4));input.Add(Key(0,c,6));}
    input.Add(Key(13,0,0));input.Add(Key(13,0,2));
    var all=input.ToArray();if(SendInput((uint)all.Length,all,Marshal.SizeOf(typeof(Input)))!=(uint)all.Length)
      throw new Exception("Owned save dialog keyboard input was not accepted");
  }
  static void CaptureDialog(AutomationElement dialog,string file) {
    var rect=dialog.Current.BoundingRectangle;
    using(var bitmap=new Bitmap((int)rect.Width,(int)rect.Height))using(var graphics=Graphics.FromImage(bitmap)) {
      graphics.CopyFromScreen((int)rect.X,(int)rect.Y,0,0,bitmap.Size);
      bitmap.Save(file,System.Drawing.Imaging.ImageFormat.Png);
    }
  }
  static string HashIcon(Icon icon) {
    using(var bitmap=icon.ToBitmap()) using(var sha=SHA256.Create()) {
      var bytes=new byte[bitmap.Width*bitmap.Height*4];int i=0;
      for(int y=0;y<bitmap.Height;y++)for(int x=0;x<bitmap.Width;x++) {
        var c=bitmap.GetPixel(x,y);bytes[i++]=c.A==0?(byte)0:c.R;bytes[i++]=c.A==0?(byte)0:c.G;
        bytes[i++]=c.A==0?(byte)0:c.B;bytes[i++]=c.A;
      }
      return BitConverter.ToString(sha.ComputeHash(bytes)).Replace("-","");
    }
  }
  [STAThread] static int Main(string[] args) {
    try {
      Console.OutputEncoding=new UTF8Encoding(false);
      SetProcessDPIAware();
      SetThreadDpiAwarenessContext(new IntPtr(-4));
      if(args[0]=="hold-file") {
        var held=new List<Microsoft.Win32.SafeHandles.SafeFileHandle>();
        try {
          for(int i=1;i<args.Length;i++) {
            var file=CreateFileW(@"\\?\"+args[i],0x80000000,0,IntPtr.Zero,3,0x80,IntPtr.Zero);
            if(file.IsInvalid){file.Dispose();throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());}
            held.Add(file);
          }
          Print(new{holding=true});Console.ReadLine();
        } finally {foreach(var file in held)file.Dispose();}
        return 0;
      }
      if(args[0]=="exclusive") {
        for(int i=1;i<args.Length;i++)using(var file=CreateFileW(@"\\?\"+args[i],0x80000000,0,IntPtr.Zero,3,0x80,IntPtr.Zero)) {
          if(file.IsInvalid)throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error(),"Model handle is not released: "+args[i]);
        }
        Print(new{exclusiveFiles=args.Length-1});return 0;
      }
      if(args[0]=="desktop") {
        var handle=OpenInputDesktop(0,false,1);if(handle==IntPtr.Zero)throw new Exception("Input desktop unavailable");
        try {var name=new StringBuilder(256);int needed;if(!GetUserObjectInformationW(handle,2,name,512,out needed))throw new Exception("Input desktop query failed");Point cursor;bool readable=GetCursorPos(out cursor);int session=System.Diagnostics.Process.GetCurrentProcess().SessionId;uint console=WTSGetActiveConsoleSessionId();bool ownerConsole=console!=0xFFFFFFFF&&console==(uint)session;Print(new{interactive=name.ToString()=="Default"&&readable&&ownerConsole,inputDesktop=name.ToString(),cursorReadable=readable,processSession=session,consoleSession=console,ownerConsole});}
        finally{CloseDesktop(handle);}return 0;
      }
      if(args[0]=="save-dialog") {
        int processId=int.Parse(args[1]);
        var ownerWindow=args.Length>3?new IntPtr(long.Parse(args[3])):IntPtr.Zero;
        AutomationElement dialog=null;var deadline=DateTime.UtcNow.AddSeconds(12);
        do {
          IntPtr native=IntPtr.Zero;
          EnumWindows((handle,data)=>{uint pid;GetWindowThreadProcessId(handle,out pid);if(pid==(uint)processId||(ownerWindow!=IntPtr.Zero&&GetAncestor(handle,3)==ownerWindow)){
            var name=new StringBuilder(256);GetClassNameW(handle,name,name.Capacity);
            if(name.ToString()=="#32770"&&IsWindowVisible(handle)){native=handle;return false;}}
            return true;},IntPtr.Zero);
          if(native!=IntPtr.Zero){dialog=AutomationElement.FromHandle(native);break;}
          Thread.Sleep(100);
        }while(DateTime.UtcNow<deadline);
        if(dialog==null){
          var owned=AutomationElement.RootElement.FindAll(TreeScope.Children,new PropertyCondition(AutomationElement.ProcessIdProperty,processId));
          var names=new List<string>();foreach(AutomationElement candidate in owned)names.Add(candidate.Current.Name+" ["+candidate.Current.ClassName+"]");
          throw new Exception("Owned native save dialog not found: "+String.Join(" | ",names));
        }
        bool cancel=args[2]=="cancel";
        if(!cancel) {
          if(!System.IO.Path.IsPathRooted(args[2]))throw new Exception("Absolute synthetic save path required");
          var edit=dialog.FindFirst(TreeScope.Descendants,new PropertyCondition(AutomationElement.AutomationIdProperty,"1001"));
          if(edit==null)throw new Exception("Native filename edit not found");
          edit.SetFocus();
          var value=(ValuePattern)edit.GetCurrentPattern(ValuePattern.Pattern);value.SetValue(args[2]);
          if(value.Current.Value!=args[2])throw new Exception("Native filename did not accept the selected path");
        }
        var button=dialog.FindFirst(TreeScope.Descendants,new PropertyCondition(AutomationElement.AutomationIdProperty,cancel?"2":"1"));
        if(button==null)throw new Exception("Native save/cancel button not found");
        if(args.Length>4)CaptureDialog(dialog,args[4]);
        string title=dialog.Current.Name;var dialogHandle=new IntPtr(dialog.Current.NativeWindowHandle);
        if(cancel)((InvokePattern)button.GetCurrentPattern(InvokePattern.Pattern)).Invoke();
        else TypeSavePath(dialogHandle,args[2]);
        var closeDeadline=DateTime.UtcNow.AddSeconds(5);
        while(IsWindowVisible(dialogHandle)&&DateTime.UtcNow<closeDeadline)Thread.Sleep(50);
        if(IsWindowVisible(dialogHandle)){
          if(args.Length>4)CaptureDialog(dialog,args[4]+".after.png");
          throw new Exception("Owned save dialog did not close after action");
        }
        Print(new{nativeSaveDialog=true,canceled=cancel,title});return 0;
      }
      if(args[0]=="cursor") {Point p;if(!GetCursorPos(out p))throw new Exception("Native cursor unavailable; keep the Windows desktop unlocked");Print(new{x=p.X,y=p.Y});return 0;}
      if(args[0]=="move") {
        // Callers already supply physical screen pixels. Normalizing them again
        // through virtual-desktop mouse_event coordinates can move to another point.
        int x=int.Parse(args[1]),y=int.Parse(args[2]);
        if(!SetCursorPos(x-1,y))throw new Exception("Native cursor unavailable on the input desktop");
        // The Electron click-through forwarder observes injected movement,
        // including when SetCursorPos itself produced no new mouse message.
        mouse_event(1,1,0,0,UIntPtr.Zero);
        if(!SetCursorPos(x,y))throw new Exception("Native cursor unavailable on the input desktop");
        Thread.Sleep(90);Point actual;if(!GetCursorPos(out actual))throw new Exception("Native cursor unavailable after movement");
        if(actual.X!=x||actual.Y!=y)throw new Exception("Native pointer position changed during the isolated check: expected "+x+","+y+"; actual "+actual.X+","+actual.Y);
        Print(new{});return 0;
      }
      if(args[0]=="up") {mouse_event(4,0,0,0,UIntPtr.Zero);Print(new{});return 0;}
      if(args[0]=="hit") {var point=new Point{X=int.Parse(args[2]),Y=int.Parse(args[3])};Print(new{expected=GetAncestor(WindowFromPoint(point),2)==new IntPtr(long.Parse(args[1]))});return 0;}
      if(args[0]=="hittest") {int x=int.Parse(args[2]),y=int.Parse(args[3]);Print(new{result=SendMessageW(new IntPtr(long.Parse(args[1])),0x84,IntPtr.Zero,new IntPtr((y<<16)|(x&0xffff))).ToInt64()});return 0;}
      if(args[0]=="drag") {
        var dragWindow=new IntPtr(long.Parse(args[1]));int x=int.Parse(args[2]),y=int.Parse(args[3]),endX=int.Parse(args[4]),endY=int.Parse(args[5]);
        if(!SetCursorPos(x,y))throw new Exception("Native cursor unavailable; keep the Windows desktop unlocked");Thread.Sleep(100);
        if(GetAncestor(WindowFromPoint(new Point{X=x,Y=y}),2)!=dragWindow)throw new Exception("Refusing drag outside the intended test window");
        mouse_event(2,0,0,0,UIntPtr.Zero);Thread.Sleep(100);
        try {for(int step=1;step<=12;step++){if(!SetCursorPos(x+(endX-x)*step/12,y+(endY-y)*step/12))throw new Exception("Native cursor became unavailable during drag");Thread.Sleep(30);}}
        finally{mouse_event(4,0,0,0,UIntPtr.Zero);}
        Print(new{});return 0;
      }
      if(args[0]=="click"||args[0]=="down") {
        var expected=new IntPtr(long.Parse(args[1]));var point=new Point{X=int.Parse(args[2]),Y=int.Parse(args[3])};
        SetCursorPos(point.X,point.Y);Thread.Sleep(100);
        if(GetAncestor(WindowFromPoint(point),2)!=expected)throw new Exception("Refusing input outside the intended synthetic test window");
        mouse_event(2,0,0,0,UIntPtr.Zero);Thread.Sleep(25);if(args[0]=="click")mouse_event(4,0,0,0,UIntPtr.Zero);Print(new{});return 0;
      }
      if(args[0]=="taskbar") {
        var handle=FindWindowW("Shell_TrayWnd",null);if(handle==IntPtr.Zero)throw new Exception("Taskbar unavailable");
        var items=AutomationElement.FromHandle(handle).FindAll(TreeScope.Descendants,Condition.TrueCondition);int count=0;
        foreach(AutomationElement item in items)if((item.Current.Name??"").IndexOf(args[1],StringComparison.OrdinalIgnoreCase)>=0)count++;
        Print(new{matches=count});return 0; // No other taskbar names are returned.
      }
      var window=new IntPtr(long.Parse(args[1]));int backdrop,dark;
      int backdropResult=DwmGetWindowAttribute(window,38,out backdrop,4),darkResult=DwmGetWindowAttribute(window,20,out dark,4);
      var iconHandle=SendMessageW(window,0x7f,new IntPtr(1),IntPtr.Zero);if(iconHandle==IntPtr.Zero)iconHandle=GetClassLongPtrW(window,-14);
      string iconHash="",sourceIconHash="";
      if(iconHandle!=IntPtr.Zero)using(var icon=Icon.FromHandle(iconHandle)) {
        iconHash=HashIcon(icon);
        var source=LoadImageW(IntPtr.Zero,args[2],1,icon.Width,icon.Height,0x10);
        if(source==IntPtr.Zero)throw new Exception("Source ICO unavailable");
        try{using(var expected=Icon.FromHandle(source))sourceIconHash=HashIcon(expected);}finally{DestroyIcon(source);}
      }
      Print(new{visible=IsWindowVisible(window),foreground=GetForegroundWindow()==window,extendedStyle=GetWindowLongPtrW(window,-20).ToInt64(),backdrop,backdropResult,dark,darkResult,iconHash,sourceIconHash});return 0;
    }catch(Exception error){Console.Error.WriteLine(error.Message);return 1;}
  }
}

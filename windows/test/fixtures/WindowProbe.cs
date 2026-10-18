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
  [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] static extern IntPtr OpenInputDesktop(uint flags,bool inherit,uint access);
  [DllImport("user32.dll")] static extern bool CloseDesktop(IntPtr handle);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern bool GetUserObjectInformationW(IntPtr handle,int index,StringBuilder name,int bytes,out int needed);
  [DllImport("user32.dll")] static extern bool GetCursorPos(out Point point);
  [DllImport("user32.dll")] static extern bool SetCursorPos(int x,int y);
  [DllImport("user32.dll")] static extern int GetSystemMetrics(int index);
  [DllImport("user32.dll")] static extern void mouse_event(uint flags,uint x,uint y,uint data,UIntPtr extra);
  [DllImport("user32.dll")] static extern IntPtr GetWindowLongPtrW(IntPtr window,int index);
  [DllImport("user32.dll")] static extern IntPtr GetClassLongPtrW(IntPtr window,int index);
  [DllImport("user32.dll")] static extern IntPtr SendMessageW(IntPtr window,int message,IntPtr w,IntPtr l);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(Point point);
  [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr window,uint flags);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern IntPtr FindWindowW(string cls,string title);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern IntPtr LoadImageW(IntPtr instance,string name,uint type,int cx,int cy,uint flags);
  [DllImport("user32.dll")] static extern bool DestroyIcon(IntPtr icon);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr window,int attribute,out int value,int bytes);
  static void Print(object value) { Console.WriteLine(new JavaScriptSerializer().Serialize(value)); }
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
      SetProcessDPIAware();
      if(args[0]=="desktop") {
        var handle=OpenInputDesktop(0,false,1);if(handle==IntPtr.Zero)throw new Exception("Input desktop unavailable");
        try {var name=new StringBuilder(256);int needed;if(!GetUserObjectInformationW(handle,2,name,512,out needed))throw new Exception("Input desktop query failed");Print(new{interactive=name.ToString()=="Default"});}
        finally{CloseDesktop(handle);}return 0;
      }
      if(args[0]=="cursor") {Point p;GetCursorPos(out p);Print(new{x=p.X,y=p.Y});return 0;}
      if(args[0]=="move") {int x=int.Parse(args[1]),y=int.Parse(args[2]);mouse_event(0xC001,(uint)((x-GetSystemMetrics(76)+0.5)*65536/GetSystemMetrics(78)),(uint)((y-GetSystemMetrics(77)+0.5)*65536/GetSystemMetrics(79)),0,UIntPtr.Zero);Thread.Sleep(90);Print(new{});return 0;}
      if(args[0]=="up") {mouse_event(4,0,0,0,UIntPtr.Zero);Print(new{});return 0;}
      if(args[0]=="hit") {var point=new Point{X=int.Parse(args[2]),Y=int.Parse(args[3])};Print(new{expected=GetAncestor(WindowFromPoint(point),2)==new IntPtr(long.Parse(args[1]))});return 0;}
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

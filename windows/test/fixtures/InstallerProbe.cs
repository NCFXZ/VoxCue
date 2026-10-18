using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Web.Script.Serialization;

// Inspect and paint only the installer fixture belonging to the supplied PID.
// PrintWindow asks that window to paint; it never reads desktop/screen pixels.
class InstallerProbe {
  delegate bool EnumProc(IntPtr handle, IntPtr parameter);
  [StructLayout(LayoutKind.Sequential)] struct Rect { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] struct ProcessBasicInfo { public IntPtr Exit,Peb,Affinity,Priority,Pid,Parent; }
  [DllImport("ntdll.dll")] static extern int NtQueryInformationProcess(IntPtr process,int type,ref ProcessBasicInfo info,int length,out int returned);
  [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] static extern IntPtr GetWindowDpiAwarenessContext(IntPtr window);
  [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc callback, IntPtr parameter);
  [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr window, EnumProc callback, IntPtr parameter);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint pid);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
  [DllImport("user32.dll")] static extern bool IsWindowEnabled(IntPtr window);
  [DllImport("user32.dll")] static extern int GetDlgCtrlID(IntPtr window);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr window, out Rect rect);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowTextW(IntPtr window, StringBuilder text, int count);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetClassNameW(IntPtr window, StringBuilder text, int count);
  [DllImport("user32.dll")] static extern IntPtr SendMessageW(IntPtr window, int message, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] static extern IntPtr SendMessageTimeoutW(IntPtr window,int message,IntPtr w,IntPtr value,uint flags,uint timeout,out IntPtr result);
  [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint access,bool inherit,uint pid);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  [DllImport("kernel32.dll")] static extern IntPtr VirtualAllocEx(IntPtr process,IntPtr address,UIntPtr size,uint allocation,uint protection);
  [DllImport("kernel32.dll")] static extern bool VirtualFreeEx(IntPtr process,IntPtr address,UIntPtr size,uint operation);
  [DllImport("kernel32.dll")] static extern bool WriteProcessMemory(IntPtr process,IntPtr address,byte[] data,UIntPtr length,out UIntPtr written);
  [DllImport("user32.dll")] static extern bool PostMessageW(IntPtr window, int message, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] static extern IntPtr GetDC(IntPtr window);
  [DllImport("user32.dll")] static extern int ReleaseDC(IntPtr window, IntPtr dc);
  [DllImport("gdi32.dll")] static extern IntPtr SelectObject(IntPtr dc, IntPtr item);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int DrawTextW(IntPtr dc, string text, int length, ref Rect rect, uint flags);
  [DllImport("user32.dll")] static extern bool PrintWindow(IntPtr window, IntPtr dc, uint flags);
  [DllImport("oleacc.dll")] static extern int AccessibleObjectFromWindow(IntPtr window,uint objectId,ref Guid iid,[MarshalAs(UnmanagedType.Interface)]out object value);
  static bool Selected(IntPtr window) {
    var iid=new Guid("618736E0-3C3D-11CF-810C-00AA00389B71");object value;
    if(AccessibleObjectFromWindow(window,0xFFFFFFFC,ref iid,out value)!=0)return false;
    try{return (Convert.ToInt32(((Accessibility.IAccessible)value).get_accState(0))&0x10)!=0;}
    finally{Marshal.ReleaseComObject(value);}
  }
  static void Toggle(IntPtr window) {
    var iid=new Guid("618736E0-3C3D-11CF-810C-00AA00389B71");object value;
    if(AccessibleObjectFromWindow(window,0xFFFFFFFC,ref iid,out value)!=0)throw new Exception("Owned checkbox is inaccessible");
    try{var accessible=(Accessibility.IAccessible)value;
      if(Convert.ToInt32(accessible.get_accRole(0))!=0x2C)throw new Exception("Owned control is not a checkbox");
      accessible.accDoDefaultAction(0);
    }finally{Marshal.ReleaseComObject(value);}
  }
  static string Text(IntPtr window) { var value=new StringBuilder(4096); GetWindowTextW(window,value,value.Capacity); return value.ToString(); }
  static string Class(IntPtr window) { var value=new StringBuilder(256); GetClassNameW(window,value,value.Capacity); return value.ToString(); }
  static void Print(object value) { Console.WriteLine(new JavaScriptSerializer{MaxJsonLength=4000000}.Serialize(value)); }
  static int Main(string[] args) {
    try {
      Console.OutputEncoding=new UTF8Encoding(false);
      SetProcessDPIAware();
      uint pid=uint.Parse(args[0]); IntPtr main=IntPtr.Zero;
      if(args[1]=="frontend") {
        int found=0;
        foreach(var process in System.Diagnostics.Process.GetProcessesByName("VoxCue.Setup.UI"))using(process) {
          try{var info=new ProcessBasicInfo();int returned;
            if(NtQueryInformationProcess(process.Handle,0,ref info,Marshal.SizeOf(info),out returned)==0 && info.Parent.ToInt64()==pid)found=process.Id;
          }catch(InvalidOperationException){}catch(System.ComponentModel.Win32Exception){}
        }
        Print(new{pid=found});return 0;
      }
      EnumWindows(delegate(IntPtr window, IntPtr unused) {
        uint owner; GetWindowThreadProcessId(window,out owner);
        if(owner==pid && IsWindowVisible(window)) { main=window; return false; }
        return true;
      },IntPtr.Zero);
      if(main==IntPtr.Zero) { Print(new{ready=false}); return 0; }
      if(args[1]=="folder") {
        if(Class(main)!="#32770")throw new Exception("Owned folder dialog is not open");
        // BFFM_SETSELECTIONW is above WM_USER: Windows does not marshal its
        // string between processes. Allocate it only in this owned fixture.
        var process=OpenProcess(0x28,false,pid);if(process==IntPtr.Zero)throw new Exception("Cannot access owned folder picker");
        var bytes=Encoding.Unicode.GetBytes(args[2]+"\0");
        var remote=VirtualAllocEx(process,IntPtr.Zero,new UIntPtr((uint)bytes.Length),0x3000,4);bool sent=false;
        try{UIntPtr written;IntPtr result;
          if(remote==IntPtr.Zero || !WriteProcessMemory(process,remote,bytes,new UIntPtr((uint)bytes.Length),out written))throw new Exception("Cannot select owned folder");
          sent=SendMessageTimeoutW(main,0x467,new IntPtr(1),remote,2,5000,out result)!=IntPtr.Zero;
          if(!sent)throw new Exception("Folder selection timed out");
        }finally{if(sent&&remote!=IntPtr.Zero)VirtualFreeEx(process,remote,UIntPtr.Zero,0x8000);CloseHandle(process);}
        Print(new{ready=true});return 0;
      }
      // Match the fixture's coordinate system when PrintWindow paints a
      // DPI-virtualized NSIS window into an in-memory bitmap.
      SetThreadDpiAwarenessContext(GetWindowDpiAwarenessContext(main));
      if(args[1]=="key") {
        var key=new IntPtr(int.Parse(args[2]));
        PostMessageW(main,0x100,key,IntPtr.Zero);PostMessageW(main,0x101,key,IntPtr.Zero);
        Print(new{ready=true});return 0;
      }
      if(args[1]=="close") { PostMessageW(main,0x10,IntPtr.Zero,IntPtr.Zero); Print(new{ready=true}); return 0; }
      if(args[1]=="button" || args[1]=="toggle") {
        IntPtr target=IntPtr.Zero;
        EnumChildWindows(main,delegate(IntPtr child,IntPtr unused){
          if(Text(child)==args[2] && IsWindowVisible(child) && IsWindowEnabled(child)){target=child;return false;}return true;
        },IntPtr.Zero);
        if(target==IntPtr.Zero)throw new Exception("Owned enabled control not found");
        if(args[1]=="toggle"){Toggle(target);Print(new{ready=true});return 0;}
        // BM_CLICK can fail on an inactive dialog. Notify only the owned
        // button's parent, without activating or clicking another application.
        PostMessageW(main,0x111,new IntPtr(GetDlgCtrlID(target)&0xFFFF),target);Print(new{ready=true});return 0;
      }
      Rect bounds; GetWindowRect(main,out bounds);
      var controls=new List<object>();
      EnumChildWindows(main,delegate(IntPtr child,IntPtr unused) {
        if(!IsWindowVisible(child))return true;
        Rect rect; GetWindowRect(child,out rect);
        var text=Text(child); var type=Class(child); int requiredHeight=0; string fontName="";
        if(type.IndexOf("STATIC",StringComparison.OrdinalIgnoreCase)>=0 && text.Length>0) {
          var dc=GetDC(child);var font=SendMessageW(child,0x31,IntPtr.Zero,IntPtr.Zero);
          if(font!=IntPtr.Zero)using(var face=Font.FromHfont(font))fontName=face.Name;
          var previous=font==IntPtr.Zero?IntPtr.Zero:SelectObject(dc,font);
          var measured=new Rect{Right=rect.Right-rect.Left};
          DrawTextW(dc,text,text.Length,ref measured,0x410); // DT_CALCRECT | DT_WORDBREAK
          requiredHeight=measured.Bottom-measured.Top;
          if(previous!=IntPtr.Zero)SelectObject(dc,previous);ReleaseDC(child,dc);
        }
        controls.Add(new{id=GetDlgCtrlID(child),type,text,enabled=IsWindowEnabled(child),selected=type.IndexOf("BUTTON",StringComparison.OrdinalIgnoreCase)>=0 && Selected(child),x=rect.Left-bounds.Left,y=rect.Top-bounds.Top,
          width=rect.Right-rect.Left,height=rect.Bottom-rect.Top,requiredHeight,fontName}); return true;
      },IntPtr.Zero);
      string png=null;
      if(args[1]=="preview") {
        using(var bitmap=new Bitmap(bounds.Right-bounds.Left,bounds.Bottom-bounds.Top)) {
          using(var graphics=Graphics.FromImage(bitmap)) {
            var dc=graphics.GetHdc();try{if(!PrintWindow(main,dc,2))throw new Exception("Owned-window painting failed");}finally{graphics.ReleaseHdc(dc);}
          }
          using(var memory=new MemoryStream()) { bitmap.Save(memory,ImageFormat.Png); png=Convert.ToBase64String(memory.ToArray()); }
        }
      }
      Print(new{ready=true,title=Text(main),className=Class(main),width=bounds.Right-bounds.Left,height=bounds.Bottom-bounds.Top,controls,png}); return 0;
    }catch(Exception error){Console.Error.WriteLine(error.Message);return 1;}
  }
}

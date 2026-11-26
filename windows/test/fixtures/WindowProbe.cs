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
  [StructLayout(LayoutKind.Sequential)] struct LastInputInfo { public uint size,time; }
  [StructLayout(LayoutKind.Sequential)] struct NativeRect { public int Left,Top,Right,Bottom; }
  [StructLayout(LayoutKind.Sequential)] struct MouseInput { public int x,y;public uint data,flags,time;public UIntPtr extra; }
  [StructLayout(LayoutKind.Sequential)] struct KeyboardInput { public ushort key,scan;public uint flags,time;public UIntPtr extra; }
  [StructLayout(LayoutKind.Explicit)] struct InputUnion { [FieldOffset(0)]public MouseInput mouse;[FieldOffset(0)]public KeyboardInput keyboard; }
  [StructLayout(LayoutKind.Sequential)] struct Input { public uint type;public InputUnion value; }
  [DllImport("user32.dll",SetLastError=true)] static extern uint SendInput(uint count,Input[] inputs,int size);
  [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
  [DllImport("kernel32.dll")] static extern uint WTSGetActiveConsoleSessionId();
  [DllImport("kernel32.dll",SetLastError=true)] static extern uint SetThreadExecutionState(uint flags);
  [DllImport("wtsapi32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool WTSQuerySessionInformationW(IntPtr server,int session,int information,out IntPtr buffer,out int bytes);
  [DllImport("wtsapi32.dll")] static extern void WTSFreeMemory(IntPtr buffer);
  [DllImport("user32.dll")] static extern IntPtr OpenInputDesktop(uint flags,bool inherit,uint access);
  [DllImport("user32.dll")] static extern bool CloseDesktop(IntPtr handle);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern bool GetUserObjectInformationW(IntPtr handle,int index,StringBuilder name,int bytes,out int needed);
  [DllImport("user32.dll")] static extern bool GetCursorPos(out Point point);
  [DllImport("user32.dll")] static extern bool GetLastInputInfo(ref LastInputInfo info);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr window,out NativeRect rect);
  [DllImport("user32.dll")] static extern bool GetClientRect(IntPtr window,out NativeRect rect);
  [DllImport("user32.dll")] static extern bool ClientToScreen(IntPtr window,ref Point point);
  [DllImport("user32.dll")] static extern int GetSystemMetrics(int index);
  [DllImport("user32.dll")] static extern bool SetCursorPos(int x,int y);
  [DllImport("user32.dll")] static extern void mouse_event(uint flags,uint x,uint y,uint data,UIntPtr extra);
  [DllImport("user32.dll")] static extern IntPtr GetWindowLongPtrW(IntPtr window,int index);
  [DllImport("user32.dll")] static extern IntPtr GetClassLongPtrW(IntPtr window,int index);
  [DllImport("user32.dll")] static extern IntPtr SendMessageW(IntPtr window,int message,IntPtr w,IntPtr l);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr window);
  [DllImport("user32.dll")] static extern short GetAsyncKeyState(int key);
  [DllImport("user32.dll",SetLastError=true)] static extern bool PostMessageW(IntPtr window,int message,IntPtr w,IntPtr l);
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
  static bool HoverPixelOwned(IntPtr target,uint expectedPid,Point point,string requiredPhase) {
    uint owner,foregroundPid,hitPid;
    bool targetPidMatches=GetWindowThreadProcessId(target,out owner)!=0 && owner==expectedPid;
    var foreground=GetForegroundWindow();
    var hitRoot=GetAncestor(WindowFromPoint(point),2);
    if(targetPidMatches && foreground==target && hitRoot==target)return true;
    if(requiredPhase==null)return false;
    GetWindowThreadProcessId(foreground,out foregroundPid);
    GetWindowThreadProcessId(hitRoot,out hitPid);
    throw new Exception("Native hover requires a hit on the foreground window of the expected process: "+
      new JavaScriptSerializer().Serialize(new { phase=requiredPhase, x=point.X, y=point.Y, targetPidMatches,
        foregroundWindowMatches=foreground==target, foregroundPidMatches=foregroundPid==expectedPid,
        hitRootMatches=hitRoot==target, hitRootPidMatches=hitPid==expectedPid }));
  }
  static int AdjacentHoverX(int x,int left) { return x==left?x+1:x-1; }
  class DesktopStatus {
    public bool interactive,cursorReadable,ownerConsole,lockWindow;
    public string inputDesktop;
    public int processSession,sessionFlags=-1;
    public uint consoleSession;
  }
  static DesktopStatus ReadDesktop() {
    var state=new DesktopStatus();
    state.processSession=System.Diagnostics.Process.GetCurrentProcess().SessionId;
    state.consoleSession=WTSGetActiveConsoleSessionId();
    state.ownerConsole=state.consoleSession!=0xFFFFFFFF&&state.consoleSession==(uint)state.processSession;
    var handle=OpenInputDesktop(0,false,1);if(handle==IntPtr.Zero)throw new Exception("Input desktop unavailable");
    try {
      var name=new StringBuilder(256);int needed;
      if(!GetUserObjectInformationW(handle,2,name,512,out needed))throw new Exception("Input desktop query failed");
      state.inputDesktop=name.ToString();Point cursor;state.cursorReadable=GetCursorPos(out cursor);
    } finally {CloseDesktop(handle);}
    IntPtr buffer;int bytes;bool sessionActive=false;
    if(WTSQuerySessionInformationW(IntPtr.Zero,state.processSession,25,out buffer,out bytes)) {
      try {
        // x64 WTSINFOEXW prefix: Level, 8-byte-aligned union, session/state/flags.
        // Read only this prefix, never username/domain or other user information.
        if(bytes>=20&&Marshal.ReadInt32(buffer,0)==1&&Marshal.ReadInt32(buffer,8)==state.processSession) {
          sessionActive=Marshal.ReadInt32(buffer,12)==0;
          state.sessionFlags=Marshal.ReadInt32(buffer,16);
        }
      } finally {WTSFreeMemory(buffer);}
    }
    bool foregroundKnown=false;uint foregroundPid;
    if(GetWindowThreadProcessId(GetForegroundWindow(),out foregroundPid)!=0) {
      try {
        string process=System.Diagnostics.Process.GetProcessById((int)foregroundPid).ProcessName;
        state.lockWindow=process.Equals("LockApp",StringComparison.OrdinalIgnoreCase)||process.Equals("LogonUI",StringComparison.OrdinalIgnoreCase);
        foregroundKnown=true;
      } catch { /* Unknown foreground ownership fails closed. */ }
    }
    state.interactive=state.inputDesktop=="Default"&&state.cursorReadable&&state.ownerConsole&&sessionActive&&state.sessionFlags==1&&foregroundKnown&&!state.lockWindow;
    return state;
  }
  static void RequireDesktop() {
    if(!ReadDesktop().interactive)throw new Exception("GUI/native input requires the owner's unlocked console; locked or unknown state refused");
  }
  static uint LastInputTick() {
    var info=new LastInputInfo{size=(uint)Marshal.SizeOf(typeof(LastInputInfo))};
    if(!GetLastInputInfo(ref info))throw new Exception("Cannot verify input inactivity on the owner desktop");
    return info.time;
  }
  static bool PointerButtonDown() {
    foreach(int button in new[]{1,2,4,5,6})if((GetAsyncKeyState(button)&0x8000)!=0)return true;
    return false;
  }
  static bool OwnedCaption(IntPtr window, uint pid, Point point) {
    uint owner;
    if(GetWindowThreadProcessId(window,out owner)==0||owner!=pid||!IsWindowVisible(window)||
       GetAncestor(WindowFromPoint(point),2)!=window)return false;
    var coordinates=new IntPtr((point.Y<<16)|(point.X&0xffff));
    return SendMessageW(window,0x84,IntPtr.Zero,coordinates).ToInt32()==2; // WM_NCHITTEST / HTCAPTION
  }
  static bool ActivateCaption(IntPtr window, uint pid) {
    NativeRect rect;Point original;
    if(!GetWindowRect(window,out rect)||!GetCursorPos(out original))return false;
    // Hit-test in physical pixels. Electron derives HTCAPTION from its actual
    // draggable region, excluding client controls, resize borders and overlays.
    for(int y=rect.Top+10;y<Math.Min(rect.Top+100,rect.Bottom);y+=8) {
      for(int i=1;i<12;i++) {
        var point=new Point{X=rect.Left+(rect.Right-rect.Left)*i/12,Y=y};
        if(!OwnedCaption(window,pid,point))continue;
        RequireDesktop();
        if((GetAsyncKeyState(1)&0x8000)!=0||(GetAsyncKeyState(2)&0x8000)!=0)return false;
        if(!SetCursorPos(point.X,point.Y))return false;
        try {
          Point actual;
          if(!GetCursorPos(out actual)||actual.X!=point.X||actual.Y!=point.Y||
             !OwnedCaption(window,pid,actual))return false;
          var clicks=new[]{
            new Input{type=0,value=new InputUnion{mouse=new MouseInput{flags=2}}},
            new Input{type=0,value=new InputUnion{mouse=new MouseInput{flags=4}}}
          };
          uint sent=SendInput(2,clicks,Marshal.SizeOf(typeof(Input)));
          if(sent==1)mouse_event(4,0,0,0,UIntPtr.Zero);
          if(sent!=2)throw new Exception("Owned caption activation input was not completed");
          return true;
        } finally {
          Point current;
          if(GetCursorPos(out current)&&current.X==point.X&&current.Y==point.Y)
            SetCursorPos(original.X,original.Y);
        }
      }
    }
    return false;
  }
  static Input Key(ushort key,ushort scan,uint flags) {return new Input{type=1,value=new InputUnion{keyboard=new KeyboardInput{key=key,scan=scan,flags=flags}}};}
  static object WindowOwnership(IntPtr handle) {
    var root=GetAncestor(handle,2);var rootOwner=GetAncestor(handle,3);
    uint processId,rootProcessId,rootOwnerProcessId;
    GetWindowThreadProcessId(handle,out processId);
    GetWindowThreadProcessId(root,out rootProcessId);
    GetWindowThreadProcessId(rootOwner,out rootOwnerProcessId);
    var name=new StringBuilder(256);GetClassNameW(handle,name,name.Capacity);
    return new{handle=handle.ToInt64().ToString(),processId,windowClass=name.ToString(),
      root=root.ToInt64().ToString(),rootProcessId,
      rootOwner=rootOwner.ToInt64().ToString(),rootOwnerProcessId};
  }
  static void ActivateSaveDialog(IntPtr dialog) {
    RequireDesktop();
    if(!IsWindowVisible(dialog))throw new Exception("Owned save dialog is no longer visible");
    SetForegroundWindow(dialog);
    var deadline=DateTime.UtcNow.AddSeconds(2);
    do {
      RequireDesktop();
      if(GetAncestor(GetForegroundWindow(),2)==dialog)return;
      Thread.Sleep(25);
    } while(DateTime.UtcNow<deadline);
    var foreground=GetForegroundWindow();uint pid;GetWindowThreadProcessId(foreground,out pid);
    throw new Exception("Owned save dialog did not acquire foreground; current process="+pid+
      "; OWNED_SAVE_DIALOG_DIAGNOSTIC="+new JavaScriptSerializer().Serialize(new{
        target=WindowOwnership(dialog),foreground=WindowOwnership(foreground)}));
  }
  static void TypeSavePath(IntPtr dialog,string path) {
    RequireDesktop();
    if(GetAncestor(GetForegroundWindow(),2)!=dialog)throw new Exception("Refusing keyboard input outside owned save dialog");
    var input=new List<Input>{Key(17,0,0),Key(65,0,0),Key(65,0,2),Key(17,0,2)};
    foreach(char c in path){input.Add(Key(0,c,4));input.Add(Key(0,c,6));}
    input.Add(Key(13,0,0));input.Add(Key(13,0,2));
    var all=input.ToArray();if(SendInput((uint)all.Length,all,Marshal.SizeOf(typeof(Input)))!=(uint)all.Length)
      throw new Exception("Owned save dialog keyboard input was not accepted");
  }
  static void CaptureDialog(AutomationElement dialog,string file) {
    RequireDesktop();
    if(GetAncestor(GetForegroundWindow(),2)!=new IntPtr(dialog.Current.NativeWindowHandle))throw new Exception("Refusing screen capture outside the owned foreground dialog");
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
      // This windowless executable communicates through redirected streams and
      // does not have a console whose code page could be changed.
      var output=new System.IO.StreamWriter(Console.OpenStandardOutput(),new UTF8Encoding(false));
      output.AutoFlush=true;Console.SetOut(output);
      var errors=new System.IO.StreamWriter(Console.OpenStandardError(),new UTF8Encoding(false));
      errors.AutoFlush=true;Console.SetError(errors);
      SetProcessDPIAware();
      SetThreadDpiAwarenessContext(new IntPtr(-4));
      if(args[0]=="hold-file") {
        var held=new List<Microsoft.Win32.SafeHandles.SafeFileHandle>();
        try {
          for(int i=1;i<args.Length;i++) {
            // Process exit can precede the kernel releasing its executable section.
            // Wait only for sharing/lock conflicts; never launch without this lock.
            var deadline=DateTime.UtcNow.AddSeconds(2);
            while(true) {
              var file=CreateFileW(@"\\?\"+args[i],0x80000000,0,IntPtr.Zero,3,0x80,IntPtr.Zero);
              if(!file.IsInvalid){held.Add(file);break;}
              int error=Marshal.GetLastWin32Error();file.Dispose();
              if((error!=32&&error!=33)||DateTime.UtcNow>=deadline)
                throw new System.ComponentModel.Win32Exception(error,"Exclusive guard cannot lock: "+args[i]);
              Thread.Sleep(25);
            }
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
      if(args[0]=="desktop") {Print(ReadDesktop());return 0;}
      RequireDesktop();
      if(args[0]=="hold-awake") {
        // A bounded power request, never a change to lock/screen-saver policy.
        if(SetThreadExecutionState(0x80000003)==0)throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
        try {Print(new{awake=true});Console.ReadLine();}
        finally {SetThreadExecutionState(0x80000000);}
        return 0;
      }
      if(args[0]=="save-dialog") {
        int processId=int.Parse(args[1]);
        var ownerWindow=args.Length>3?new IntPtr(long.Parse(args[3])):IntPtr.Zero;
        AutomationElement dialog=null;var deadline=DateTime.UtcNow.AddSeconds(12);
        do {
          RequireDesktop();
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
        var dialogHandle=new IntPtr(dialog.Current.NativeWindowHandle);
        uint dialogProcess;GetWindowThreadProcessId(dialogHandle,out dialogProcess);
        try {
        AutomationElement edit=null;
        if(!cancel) {
          if(!System.IO.Path.IsPathRooted(args[2]))throw new Exception("Absolute synthetic save path required");
          edit=dialog.FindFirst(TreeScope.Descendants,new PropertyCondition(AutomationElement.AutomationIdProperty,"1001"));
          if(edit==null)throw new Exception("Native filename edit not found");
          ActivateSaveDialog(dialogHandle);
          edit.SetFocus();
          var value=(ValuePattern)edit.GetCurrentPattern(ValuePattern.Pattern);value.SetValue(args[2]);
          if(value.Current.Value!=args[2])throw new Exception("Native filename did not accept the selected path");
        }
        var button=dialog.FindFirst(TreeScope.Descendants,new PropertyCondition(AutomationElement.AutomationIdProperty,cancel?"2":"1"));
        if(button==null)throw new Exception("Native save/cancel button not found");
        if(args.Length>4)CaptureDialog(dialog,args[4]);
        string title=dialog.Current.Name;
        RequireDesktop();
        if(cancel)((InvokePattern)button.GetCurrentPattern(InvokePattern.Pattern)).Invoke();
        else {ActivateSaveDialog(dialogHandle);edit.SetFocus();TypeSavePath(dialogHandle,args[2]);}
        var closeDeadline=DateTime.UtcNow.AddSeconds(5);
        while(IsWindowVisible(dialogHandle)&&DateTime.UtcNow<closeDeadline)Thread.Sleep(50);
        if(IsWindowVisible(dialogHandle)){
          if(args.Length>4)CaptureDialog(dialog,args[4]+".after.png");
          throw new Exception("Owned save dialog did not close after action");
        }
        Print(new{nativeSaveDialog=true,canceled=cancel,title});return 0;
        } catch {
          // Cancel only the dialog already attributed to this synthetic owner.
          // Preserve the original failure and never type into another window.
          uint currentProcess;
          if(IsWindowVisible(dialogHandle)&&GetWindowThreadProcessId(dialogHandle,out currentProcess)!=0&&currentProcess==dialogProcess&&
             (currentProcess==(uint)processId||(ownerWindow!=IntPtr.Zero&&GetAncestor(dialogHandle,3)==ownerWindow)))
            PostMessageW(dialogHandle,0x10,IntPtr.Zero,IntPtr.Zero);
          throw;
        }
      }
      if(args[0]=="cursor"||args[0]=="cursor-activity") {
        Point p;if(!GetCursorPos(out p))throw new Exception("Native cursor unavailable; keep the Windows desktop unlocked");
        if(args[0]=="cursor") {Print(new{x=p.X,y=p.Y});return 0;}
        uint tick=LastInputTick();
        Print(new{x=p.X,y=p.Y,inputTick=tick,idleMs=unchecked((uint)Environment.TickCount-tick),buttonDown=PointerButtonDown()});return 0;
      }
      if(args[0]=="geometry") {
        var owned=new IntPtr(long.Parse(args[1]));uint pid;
        if(GetWindowThreadProcessId(owned,out pid)==0||pid!=uint.Parse(args[2]))throw new Exception("Geometry target does not belong to the expected test process");
        NativeRect outer,client;var origin=new Point();
        if(!GetWindowRect(owned,out outer)||!GetClientRect(owned,out client)||!ClientToScreen(owned,ref origin))throw new Exception("Owned window geometry unavailable");
        Print(new{x=outer.Left,y=outer.Top,width=outer.Right-outer.Left,height=outer.Bottom-outer.Top,clientX=origin.X,clientY=origin.Y,clientWidth=client.Right-client.Left,clientHeight=client.Bottom-client.Top});return 0;
      }
      if(args[0]=="pointer-owned"||args[0]=="down-owned"||args[0]=="check-owned") {
        var target=new IntPtr(long.Parse(args[3]));uint pid;Point point;
        if(GetWindowThreadProcessId(target,out pid)==0||pid!=uint.Parse(args[4])||
           GetForegroundWindow()!=target||!GetCursorPos(out point)||point.X!=int.Parse(args[1])||
           point.Y!=int.Parse(args[2])||GetAncestor(WindowFromPoint(point),2)!=target)
          throw new Exception("Native pointer must remain on its original foreground target");
        if(args[0]=="down-owned") {
          if((GetAsyncKeyState(1)&0x8000)!=0)throw new Exception("Mouse is already pressed");
          mouse_event(2,0,0,0,UIntPtr.Zero);
        } else if(args[0]=="check-owned"&&(GetAsyncKeyState(1)&0x8000)==0)throw new Exception("Native hold was released early");
        Print(new{});return 0;
      }
      if(args[0]=="hover-candidate") {
        RequireDesktop();
        var target=new IntPtr(long.Parse(args[1]));uint expected=uint.Parse(args[2]),owner;
        if(args.Length<5||args.Length>35||(args.Length-3)%2!=0)throw new Exception("Invalid hover candidates");
        var foreground=GetForegroundWindow();
        if(GetWindowThreadProcessId(target,out owner)==0||owner!=expected||foreground!=target)
          throw new Exception("Candidate selection requires the owned foreground window; "+
            "OWNED_HOVER_DIAGNOSTIC="+new JavaScriptSerializer().Serialize(new{
              expectedProcessId=expected,target=WindowOwnership(target),foreground=WindowOwnership(foreground)}));
        int left=GetSystemMetrics(76),top=GetSystemMetrics(77),width=GetSystemMetrics(78),height=GetSystemMetrics(79);
        for(int i=3;i<args.Length;i+=2) {
          int x=int.Parse(args[i]),y=int.Parse(args[i+1]);
          if(width>=2 && x>=left && x<left+width && y>=top && y<top+height &&
             HoverPixelOwned(target,expected,new Point{X=AdjacentHoverX(x,left),Y=y},null) &&
             HoverPixelOwned(target,expected,new Point{X=x,Y=y},null)) {
            Print(new{index=(i-3)/2});return 0;
          }
        }
        Print(new{index=-1});return 0;
      }
      if(args[0]=="move"||args[0]=="hover-owned") {
        RequireDesktop();
        // Absolute SendInput uses the physical virtual desktop, including a
        // negative monitor origin. Pixel centers avoid normalization rounding.
        int x=int.Parse(args[1]),y=int.Parse(args[2]);
        var target=args[0]=="hover-owned"?new IntPtr(long.Parse(args[3])):IntPtr.Zero;
        Action<Point,string> check=(point,phase)=>{
          if(target!=IntPtr.Zero)HoverPixelOwned(target,uint.Parse(args[4]),point,phase);
        };
        int left=GetSystemMetrics(76),top=GetSystemMetrics(77),width=GetSystemMetrics(78),height=GetSystemMetrics(79);
        if(width<2||height<1||x<left||x>=left+width||y<top||y>=top+height)throw new Exception("Native pointer target is outside the virtual desktop");
        int[] points={AdjacentHoverX(x,left),x};
        var moves=new Input[2];
        for(int i=0;i<moves.Length;i++) {
          check(new Point{X=points[i],Y=y},i==0?"before-adjacent":"before-target");
          moves[i]=new Input{type=0,value=new InputUnion{mouse=new MouseInput{
            x=(int)(((2L*(points[i]-left)+1)*65536)/(2L*width)),
            y=(int)(((2L*(y-top)+1)*65536)/(2L*height)),
            // MOVE | ABSOLUTE | VIRTUALDESK | MOVE_NOCOALESCE. Do not inject an
            // accelerated relative detour or overwrite its queued final event.
            flags=0xE001
          }}};
        }
        if(args[0]=="move"&&args.Length==7&&args[3]=="if-quiet") {
          // Input may resume while the JavaScript caller launches this process.
          Point current;if(!GetCursorPos(out current))throw new Exception("Native cursor unavailable before matrix movement");
          if(current.X!=int.Parse(args[4])||current.Y!=int.Parse(args[5])||
             PointerButtonDown()||LastInputTick()!=uint.Parse(args[6])) {Print(new{skipped=true});return 0;}
        }
        if(SendInput((uint)moves.Length,moves,Marshal.SizeOf(typeof(Input)))!=(uint)moves.Length)
          throw new Exception("Native pointer input was not accepted");
        var moveDeadline=DateTime.UtcNow.AddSeconds(1);
        while(true) {
          Point moved;if(!GetCursorPos(out moved))throw new Exception("Native cursor unavailable while waiting for injected movement");
          if(moved.X==x&&moved.Y==y)break;
          if(DateTime.UtcNow>=moveDeadline)throw new Exception("Injected native cursor movement was not observed before the deadline");
          Thread.Sleep(5);
        }
        RequireDesktop();
        Thread.Sleep(90);Point actual;if(!GetCursorPos(out actual))throw new Exception("Native cursor unavailable after movement");
        if(actual.X!=x||actual.Y!=y)throw new Exception("Native pointer position changed during the isolated check: expected "+x+","+y+"; actual "+actual.X+","+actual.Y);
        check(actual,"after-target");
        Print(new{});return 0;
      }
      if(args[0]=="up") {mouse_event(4,0,0,0,UIntPtr.Zero);Print(new{});return 0;}
      if(args[0]=="foreground") {
        var foreground=GetForegroundWindow();uint processId;GetWindowThreadProcessId(foreground,out processId);
        Print(new{handle=foreground.ToInt64().ToString(),processId,processName=processId==0?"none":System.Diagnostics.Process.GetProcessById((int)processId).ProcessName});return 0;
      }
      if(args[0]=="focus-owned") {
        var target=new IntPtr(long.Parse(args[1]));uint targetPid;
        if(GetWindowThreadProcessId(target,out targetPid)==0||targetPid!=uint.Parse(args[2])||
           !IsWindowVisible(target)||GetAncestor(target,2)!=target)
          throw new Exception("Focus target is not the visible top-level window of the owned Electron process");
        bool requested=false,caption=false;
        if(GetForegroundWindow()!=target) {
          requested=SetForegroundWindow(target);
          if(GetForegroundWindow()!=target) {
            // UI Automation focuses only the already attributed HWND, without
            // synthesizing a click or interacting with another application.
            try { AutomationElement.FromHandle(target).SetFocus(); }
            catch(InvalidOperationException) { /* Report native state below. */ }
            if(args.Length==4&&args[3]=="caption"&&GetForegroundWindow()!=target)
              caption=ActivateCaption(target,targetPid);
          }
        }
        var foreground=GetForegroundWindow();uint foregroundPid;GetWindowThreadProcessId(foreground,out foregroundPid);
        var className=new StringBuilder(128);GetClassNameW(foreground,className,className.Capacity);
        Print(new{foregroundHandle=foreground.ToInt64().ToString(),foregroundPid,foregroundClass=className.ToString(),requested,caption});return 0;
      }
      if(args[0]=="hit") {
        var point=new Point{X=int.Parse(args[2]),Y=int.Parse(args[3])};
        var target=new IntPtr(long.Parse(args[1]));var actual=GetAncestor(WindowFromPoint(point),2);
        if(actual==target){Print(new{expected=true});return 0;}
        uint targetProcess,actualProcess;GetWindowThreadProcessId(target,out targetProcess);GetWindowThreadProcessId(actual,out actualProcess);
        var name=new StringBuilder(256);GetClassNameW(actual,name,name.Capacity);
        NativeRect targetBounds,actualBounds;GetWindowRect(target,out targetBounds);GetWindowRect(actual,out actualBounds);
        Print(new{expected=false,point,targetProcess,actualProcess,actualClass=name.ToString(),targetBounds,actualBounds,
          actualProcessName=actualProcess==0?"none":System.Diagnostics.Process.GetProcessById((int)actualProcess).ProcessName});return 0;
      }
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

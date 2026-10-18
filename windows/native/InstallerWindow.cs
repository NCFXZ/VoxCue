using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;

// Installer-owned UI only. It never reads VoxCue userData or account settings.
class InstallerWindow : Form {
  static readonly Color Surface=Color.White, Foreground=Color.FromArgb(37,41,43),
    Muted=Color.FromArgb(96,106,112), Border=Color.FromArgb(233,235,237),
    Accent=Color.FromArgb(0,103,180), Soft=Color.FromArgb(247,248,249);
  readonly Image logo;
  readonly string version, language, mode;
  readonly bool preview, allowRun;
  readonly Label brand=new Label(), metadata=new Label(), status=new Label(), percentage=new Label();
  readonly ActionButton primary=new ActionButton(), close=new ActionButton();
  readonly LaunchChoice launch=new LaunchChoice();
  readonly ProgressTrack progress=new ProgressTrack();
  readonly System.Windows.Forms.Timer timer=new System.Windows.Forms.Timer();
  string phase="ready";
  int percent;
  public static string[] Arguments;
  EventWaitHandle startEvent, cancelEvent, installingEvent, doneEvent, failedEvent, finishEvent, runEvent;
  System.Diagnostics.Process owner;
  IntPtr ownerWindow;
  bool approvedClose;

  [DllImport("user32.dll")] static extern bool ReleaseCapture();
  [DllImport("user32.dll")] static extern IntPtr SendMessageW(IntPtr window,int message,IntPtr w,IntPtr l);
  [DllImport("user32.dll")] static extern IntPtr SendMessageTimeoutW(IntPtr window,int message,IntPtr w,IntPtr l,uint flags,uint timeout,out IntPtr result);
  [DllImport("user32.dll")] static extern bool ShowWindowAsync(IntPtr window,int command);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window,out uint pid);
  [DllImport("dwmapi.dll")] static extern int DwmSetWindowAttribute(IntPtr window,int attribute,ref int value,int size);
  static string Option(string name,string fallback="") {
    foreach(var value in Arguments)if(value.StartsWith(name+"=",StringComparison.Ordinal))return value.Substring(name.Length+1);
    return fallback;
  }
  string Local(string english,string chinese,string traditional=null) {
    return language=="2052"?chinese:language=="1028"?(traditional??chinese):english;
  }
  public InstallerWindow() {
    preview=Option("--preview")!=""; version=Option("--version","0.2.2"); language=Option("--language","2052");
    mode=Option("--mode","install");
    allowRun=Option("--run-after-finish","true")=="true";
    using(var source=Image.FromFile(Option("--logo")))logo=new Bitmap(source);
    AutoScaleMode=AutoScaleMode.None;
    ClientSize=new Size(480,248); FormBorderStyle=FormBorderStyle.None;
    StartPosition=FormStartPosition.CenterScreen; BackColor=Surface;
    Font=new Font("Microsoft YaHei UI",10.5f,FontStyle.Regular,GraphicsUnit.Point);
    Text="VoxCue"; DoubleBuffered=true; ShowInTaskbar=true;
    Icon=Icon.ExtractAssociatedIcon(Application.ExecutablePath);
    brand.Text="VoxCue"; brand.Font=new Font("Segoe UI",19,FontStyle.Bold,GraphicsUnit.Point);
    brand.ForeColor=Foreground; brand.SetBounds(96,29,280,36);
    metadata.Text=version+" · Windows x64"; metadata.ForeColor=Muted;
    metadata.Font=new Font("Segoe UI",9,FontStyle.Regular,GraphicsUnit.Point);metadata.SetBounds(98,66,290,20);
    status.ForeColor=Foreground; status.SetBounds(28,122,350,26);
    percentage.ForeColor=Muted;percentage.TextAlign=ContentAlignment.TopRight;percentage.SetBounds(390,122,62,26);
    primary.SetBounds(312,184,140,36);primary.Fill=Accent;primary.Ink=Color.White;
    primary.Click+=delegate{ActivatePrimary();};
    close.SetBounds(438,10,30,30);close.IsClose=true;close.Fill=Surface;close.Ink=Muted;
    close.Text=Local("Close","关闭","關閉");close.Click+=delegate{Close();};
    AcceptButton=primary;CancelButton=close;
    launch.SetBounds(28,122,380,30);launch.Text=Local("Open VoxCue","打开 VoxCue","開啟 VoxCue");launch.Checked=true;
    progress.SetBounds(28,157,424,6);
    Controls.AddRange(new Control[]{brand,metadata,status,percentage,primary,close,launch,progress});
    foreach(var control in new Control[]{brand,metadata})control.MouseDown+=Drag;
    MouseDown+=Drag;
    float scale=DpiScale(this);
    if(scale!=1) {
      foreach(Control control in Controls)control.SetBounds((int)(control.Left*scale),(int)(control.Top*scale),(int)(control.Width*scale),(int)(control.Height*scale));
      ClientSize=new Size((int)(480*scale),(int)(248*scale));
    }
    timer.Interval=100;timer.Tick+=delegate{Poll();};
    if(!preview) {
      var prefix=Option("--events");
      owner=System.Diagnostics.Process.GetProcessById(int.Parse(Option("--owner")));
      ownerWindow=new IntPtr(long.Parse(Option("--window")));
      uint pid;GetWindowThreadProcessId(ownerWindow,out pid);
      if(pid!=owner.Id)throw new InvalidOperationException("Installer window owner mismatch");
      startEvent=EventWaitHandle.OpenExisting(prefix+"-start");
      cancelEvent=EventWaitHandle.OpenExisting(prefix+"-cancel");
      installingEvent=EventWaitHandle.OpenExisting(prefix+"-installing");
      doneEvent=EventWaitHandle.OpenExisting(prefix+"-done");
      failedEvent=EventWaitHandle.OpenExisting(prefix+"-failed");
      finishEvent=EventWaitHandle.OpenExisting(prefix+"-finish");
      runEvent=EventWaitHandle.OpenExisting(prefix+"-run");
    }
    SetPhase(preview?Option("--preview"):"ready");
    timer.Start();
  }
  protected override void OnHandleCreated(EventArgs e) {
    base.OnHandleCreated(e);
    int rounded=2;try{DwmSetWindowAttribute(Handle,33,ref rounded,4);}catch(DllNotFoundException){}
  }
  protected override void OnPaint(PaintEventArgs e) {
    base.OnPaint(e);e.Graphics.SmoothingMode=SmoothingMode.AntiAlias;
    float scale=DpiScale(this);
    e.Graphics.DrawImage(logo,new RectangleF(28*scale,28*scale,52*scale,52*scale));
    using(var pen=new Pen(Border,scale)) {
      e.Graphics.DrawLine(pen,28*scale,104*scale,452*scale,104*scale);
      e.Graphics.DrawRectangle(pen,0,0,ClientSize.Width-1,ClientSize.Height-1);
    }
  }
  void Drag(object sender,MouseEventArgs e) {
    if(e.Button==MouseButtons.Left){ReleaseCapture();SendMessageW(Handle,0xA1,new IntPtr(2),IntPtr.Zero);}
  }
  void SetPhase(string value) {
    phase=value; bool running=value=="installing",done=value=="done",failed=value=="failed",uninstall=mode=="uninstall";
    status.Visible=!done || uninstall || !allowRun;
    status.Text=failed?(uninstall?Local("Uninstall failed","卸载失败","解除安裝失敗"):Local("Installation failed","安装失败","安裝失敗")):
      running?(uninstall?Local("Uninstalling…","正在卸载…","正在解除安裝…"):Local("Installing…","正在安装…","正在安裝…")):
      done?(uninstall?Local("VoxCue has been removed","VoxCue 已卸载","VoxCue 已解除安裝"):Local("Installation complete","安装完成","安裝完成")):
      uninstall?Local("Your data will be kept","保留个人数据","保留個人資料"):Local("Ready to install","准备安装","準備安裝");
    launch.Visible=done && !uninstall && allowRun;
    progress.Visible=running;percentage.Visible=running;
    primary.Enabled=!running;
    primary.Text=failed?Local("Close","关闭","關閉"):done?Local("Finish","完成"):running?(uninstall?Local("Uninstalling…","正在卸载…","正在解除安裝…"):Local("Installing…","正在安装…","正在安裝…")):
      uninstall?Local("Uninstall","卸载","解除安裝"):Local("Install","安装","安裝");
    close.Enabled=!running;
    if(running) {percent=preview?42:0;UpdateProgress();}
    Invalidate();
  }
  void UpdateProgress(){progress.Value=percent;percentage.Text=percent+"%";}
  void ActivatePrimary() {
    if(phase=="ready") {
      if(preview){SetPhase("installing");return;}
      startEvent.Set();SetPhase("installing");
    }else if(phase=="done"||phase=="failed") {
      if(!preview){if(phase=="done"&&launch.Checked&&mode!="uninstall"&&allowRun)runEvent.Set();finishEvent.Set();}
      approvedClose=true;Close();
    }
  }
  void Poll() {
    if(preview)return;
    if(owner.HasExited){approvedClose=true;Close();return;}
    ShowWindowAsync(ownerWindow,0);
    if(failedEvent.WaitOne(0)){if(phase!="failed")SetPhase("failed");return;}
    if(doneEvent.WaitOne(0)){if(phase!="done")SetPhase("done");return;}
    if(installingEvent.WaitOne(0)) {
      if(phase!="installing")SetPhase("installing");
      // The progress control is on NSIS's current child page, not its placeholder.
      var bar=FindProgress(ownerWindow);
      if(bar!=IntPtr.Zero){IntPtr current,maximum;
        // The engine may be busy extracting or waiting on our completion event.
        // Never let a synchronous window message freeze the visible UI.
        if(SendMessageTimeoutW(bar,0x408,IntPtr.Zero,IntPtr.Zero,2,25,out current)!=IntPtr.Zero &&
           SendMessageTimeoutW(bar,0x407,IntPtr.Zero,IntPtr.Zero,2,25,out maximum)!=IntPtr.Zero && maximum.ToInt32()>0) {
          percent=Math.Max(0,Math.Min(99,current.ToInt32()*100/maximum.ToInt32()));UpdateProgress();}}
    }
  }
  delegate bool EnumProc(IntPtr window,IntPtr parameter);
  [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr parent,EnumProc callback,IntPtr parameter);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetClassNameW(IntPtr window,System.Text.StringBuilder value,int count);
  static IntPtr FindProgress(IntPtr parent) {
    IntPtr result=IntPtr.Zero;EnumChildWindows(parent,delegate(IntPtr child,IntPtr unused){
      var name=new System.Text.StringBuilder(128);GetClassNameW(child,name,128);
      if(name.ToString()=="msctls_progress32")result=child;return true;
    },IntPtr.Zero);return result;
  }
  protected override void OnFormClosing(FormClosingEventArgs e) {
    if(!approvedClose) {
      if(phase=="installing" && !preview){e.Cancel=true;return;}
      if(!preview){if(phase=="done"||phase=="failed")finishEvent.Set();else cancelEvent.Set();}
    }
    base.OnFormClosing(e);
  }
  protected override void Dispose(bool disposing) {
    if(disposing){timer.Dispose();logo.Dispose();if(owner!=null)owner.Dispose();
      foreach(var handle in new[]{startEvent,cancelEvent,installingEvent,doneEvent,failedEvent,finishEvent,runEvent})if(handle!=null)handle.Dispose();}
    base.Dispose(disposing);
  }
  [STAThread] static int Main(string[] args) {
    Arguments=args;Application.EnableVisualStyles();Application.SetCompatibleTextRenderingDefault(false);
    try{using(var window=new InstallerWindow())Application.Run(window);return 0;}catch{return 1;}
  }
  class ActionButton : Button {
    public Color Fill,Ink; public bool IsClose;bool hovered,pressed;
    public ActionButton(){SetStyle(ControlStyles.UserPaint|ControlStyles.AllPaintingInWmPaint|ControlStyles.OptimizedDoubleBuffer,true);
      FlatStyle=FlatStyle.Flat;FlatAppearance.BorderSize=0;Cursor=Cursors.Hand;}
    protected override void OnMouseEnter(EventArgs e){hovered=true;Invalidate();base.OnMouseEnter(e);}
    protected override void OnMouseLeave(EventArgs e){hovered=false;pressed=false;Invalidate();base.OnMouseLeave(e);}
    protected override void OnMouseDown(MouseEventArgs e){pressed=true;Invalidate();base.OnMouseDown(e);}
    protected override void OnMouseUp(MouseEventArgs e){pressed=false;Invalidate();base.OnMouseUp(e);}
    protected override void OnPaint(PaintEventArgs e) {
      e.Graphics.Clear(Surface);e.Graphics.SmoothingMode=SmoothingMode.AntiAlias;
      float scale=DpiScale(this);var box=new RectangleF(0,0,Width-1,Height-1);
      var fill=!Enabled?Soft:IsClose?(hovered?Color.FromArgb(246,226,228):Surface):pressed?Color.FromArgb(0,77,135):hovered?Color.FromArgb(0,90,160):Fill;
      using(var shape=Rounded(box,8*scale))using(var brush=new SolidBrush(fill))e.Graphics.FillPath(brush,shape);
      if(IsClose){using(var pen=new Pen(hovered?Color.FromArgb(197,43,50):Ink,1.5f*scale)){
        float midX=Width/2f,midY=Height/2f,r=4*scale;e.Graphics.DrawLine(pen,midX-r,midY-r,midX+r,midY+r);e.Graphics.DrawLine(pen,midX+r,midY-r,midX-r,midY+r);}}
      else TextRenderer.DrawText(e.Graphics,Text,Font,ClientRectangle,Enabled?Ink:Muted,TextFormatFlags.HorizontalCenter|TextFormatFlags.VerticalCenter|TextFormatFlags.NoPadding);
    }
  }
  class LaunchChoice : CheckBox {
    public LaunchChoice(){SetStyle(ControlStyles.UserPaint|ControlStyles.AllPaintingInWmPaint|ControlStyles.OptimizedDoubleBuffer,true);Cursor=Cursors.Hand;}
    protected override void OnPaint(PaintEventArgs e){e.Graphics.Clear(Surface);e.Graphics.SmoothingMode=SmoothingMode.AntiAlias;float scale=DpiScale(this);
      var rect=new RectangleF(0,7*scale,16*scale,16*scale);
      using(var shape=Rounded(rect,4*scale))using(var fill=new SolidBrush(Checked?Accent:Surface))using(var pen=new Pen(Checked?Accent:Border,scale)){e.Graphics.FillPath(fill,shape);e.Graphics.DrawPath(pen,shape);}
      if(Checked)using(var pen=new Pen(Color.White,1.6f*scale)){e.Graphics.DrawLines(pen,new[]{new PointF(4*scale,15*scale),new PointF(7*scale,18*scale),new PointF(12*scale,12*scale)});}
      TextRenderer.DrawText(e.Graphics,Text,Font,new Rectangle((int)(24*scale),0,Width-(int)(24*scale),Height),Foreground,TextFormatFlags.VerticalCenter|TextFormatFlags.NoPadding);
    }
  }
  class ProgressTrack : Control {
    int value;public int Value{get{return value;}set{this.value=value;Invalidate();}}
    public ProgressTrack(){SetStyle(ControlStyles.UserPaint|ControlStyles.AllPaintingInWmPaint|ControlStyles.OptimizedDoubleBuffer,true);AccessibleRole=AccessibleRole.ProgressBar;AccessibleName="Installation progress";}
    protected override void OnPaint(PaintEventArgs e){e.Graphics.Clear(Surface);e.Graphics.SmoothingMode=SmoothingMode.AntiAlias;
      using(var shape=Rounded(new RectangleF(0,0,Width,Height),Height/2f))using(var fill=new SolidBrush(Border))e.Graphics.FillPath(fill,shape);
      if(value>0)using(var shape=Rounded(new RectangleF(0,0,Width*value/100f,Height),Height/2f))using(var fill=new SolidBrush(Accent))e.Graphics.FillPath(fill,shape);}
  }
  static float DpiScale(Control control){using(var graphics=control.CreateGraphics())return graphics.DpiX/96f;}
  static GraphicsPath Rounded(RectangleF rect,float radius){var path=new GraphicsPath();float d=Math.Min(radius*2,Math.Min(rect.Width,rect.Height));
    path.AddArc(rect.X,rect.Y,d,d,180,90);path.AddArc(rect.Right-d,rect.Y,d,d,270,90);path.AddArc(rect.Right-d,rect.Bottom-d,d,d,0,90);path.AddArc(rect.X,rect.Bottom-d,d,d,90,90);path.CloseFigure();return path;}
}

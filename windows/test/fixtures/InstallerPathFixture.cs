using System;

// Calls only the installer's pure path guard; no Form, registry or app is opened.
class InstallerPathFixture {
  static int Main(string[] args) {
    string full;
    var issue=InstallerWindow.CheckInstallPath(args[0],args.Length>1&&args[1]=="upgrade",out full);
    Console.WriteLine(issue+"|"+full);
    return (int)issue;
  }
}

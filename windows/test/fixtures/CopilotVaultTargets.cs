using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Principal;

// Guest-only metadata probe. No CredentialBlob pointer, size or bytes are read.
public static class CopilotVaultTargets {
  [DllImport("advapi32.dll", EntryPoint="CredEnumerateW", CharSet=CharSet.Unicode, SetLastError=true)]
  static extern bool CredEnumerate(string filter,uint flags,out uint count,out IntPtr credentials);
  [DllImport("advapi32.dll")]
  static extern void CredFree(IntPtr buffer);

  public static string[] Names() {
    using(var identity=WindowsIdentity.GetCurrent()) {
      var account=identity.Name.Split('\\');
      var profile=Path.GetFullPath(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile));
      if(!String.Equals(account[account.Length-1],"WDAGUtilityAccount",StringComparison.OrdinalIgnoreCase)||
         !String.Equals(profile,@"C:\Users\WDAGUtilityAccount",StringComparison.OrdinalIgnoreCase))
        throw new InvalidOperationException("Vault metadata probing is restricted to the disposable Sandbox guest.");
      foreach(var directory in new[]{@"C:\",@"C:\Users",profile})
        if((File.GetAttributes(directory)&FileAttributes.ReparsePoint)!=0)
          throw new InvalidOperationException("Redirected Sandbox profile.");
    }
    uint count;
    IntPtr entries;
    if(!CredEnumerate(null,0,out count,out entries)) {
      if(Marshal.GetLastWin32Error()==1168)return new string[0];
      throw new InvalidOperationException("Credential target metadata is unavailable.");
    }
    try {
      if(count>4096)throw new InvalidOperationException("Unexpected guest credential count.");
      var names=new HashSet<string>(StringComparer.Ordinal);
      for(int i=0;i<(int)count;i++) {
        var credential=Marshal.ReadIntPtr(entries,checked(i*IntPtr.Size));
        // CREDENTIALW starts with two DWORDs; only its next TargetName pointer
        // is inspected. Do not marshal the structure or access any later field.
        var target=Marshal.ReadIntPtr(credential,8);
        if(target!=IntPtr.Zero)names.Add(Marshal.PtrToStringUni(target));
      }
      var sorted=new List<string>(names);
      sorted.Sort(StringComparer.Ordinal);
      return sorted.ToArray();
    } finally { CredFree(entries); }
  }
}

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$PfxPath,
    [Parameter(Mandatory = $true)][string]$UserDataDirectory,
    [Security.SecureString]$Password,
    [Net.IPAddress]$ListenAddress
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$pfxFile = (Resolve-Path -LiteralPath $PfxPath).ProviderPath
$root = (Resolve-Path -LiteralPath $UserDataDirectory).ProviderPath
$target = Join-Path $root 'remote-connection-tls'
if (!(Test-Path -LiteralPath $root -PathType Container)) { throw 'The user data directory does not exist.' }
if ($null -eq $Password) { $Password = Read-Host 'PFX password' -AsSecureString }

function Test-PrivateIPv4([Net.IPAddress]$address) {
    if ($address.AddressFamily -ne 'InterNetwork') { return $false }
    $bytes = $address.GetAddressBytes()
    return $bytes[0] -eq 10 -or ($bytes[0] -eq 172 -and $bytes[1] -ge 16 -and $bytes[1] -le 31) -or
        ($bytes[0] -eq 192 -and $bytes[1] -eq 168)
}
function Read-DerLength([byte[]]$data, [ref]$offset) {
    if ($offset.Value -ge $data.Length) { throw 'Invalid subject alternative names.' }
    $length = [int]$data[$offset.Value]
    $offset.Value++
    if ($length -lt 128) { return $length }
    $count = $length -band 127
    if ($count -lt 1 -or $count -gt 3 -or $offset.Value + $count -gt $data.Length) { throw 'Invalid DER length.' }
    $length = 0
    while ($count-- -gt 0) {
        $length = $length * 256 + $data[$offset.Value]
        $offset.Value++
    }
    return $length
}
function Get-CertificateIPs($certificate) {
    $extension = $certificate.Extensions['2.5.29.17']
    if (!$extension) { return }
    $data = $extension.RawData
    $offset = 1
    $size = Read-DerLength $data ([ref]$offset)
    if ($data[0] -ne 48 -or $size -ne $data.Length - $offset) { throw 'Invalid subject alternative names.' }
    while ($offset -lt $data.Length) {
        $tag = $data[$offset++]
        $size = Read-DerLength $data ([ref]$offset)
        if ($size -gt $data.Length - $offset) { throw 'Invalid subject alternative names.' }
        if ($tag -eq 135 -and $size -eq 4) { [Net.IPAddress]::new([byte[]]($data[$offset..($offset + 3)])) }
        $offset += $size
    }
}
function Assert-RegularPath([string]$file, [bool]$isDirectory) {
    $item = Get-Item -LiteralPath $file -Force -ErrorAction Stop
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $item.PSIsContainer -ne $isDirectory) {
        throw 'Unexpected TLS configuration path.'
    }
}
$certificates = [Security.Cryptography.X509Certificates.X509Certificate2Collection]::new()
$stage = $null
$plain = $null
try {
    $flags = [Security.Cryptography.X509Certificates.X509KeyStorageFlags]'EphemeralKeySet, Exportable'
    # .NET Framework's collection Import takes a string password. Keep it inside this process.
    $credential = [Management.Automation.PSCredential]::new('PFX', $Password)
    $certificates.Import($pfxFile, $credential.GetNetworkCredential().Password, $flags)
    $identities = @($certificates | Where-Object { $_.HasPrivateKey })
    if ($identities.Count -ne 1) { throw 'The PFX must contain one exportable server key.' }
    $leaf = $identities[0]
    $ips = @(Get-CertificateIPs $leaf)
    $addresses = if ($ListenAddress) { $ListenAddress } else {
        foreach ($adapter in [Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces()) {
            if ($adapter.OperationalStatus -eq 'Up') {
                foreach ($entry in $adapter.GetIPProperties().UnicastAddresses) {
                    if (Test-PrivateIPv4 $entry.Address) { $entry.Address }
                }
            }
        }
    }
    if (!$addresses) { throw 'Specify the private IPv4 address with -ListenAddress.' }
    foreach ($address in $addresses) {
        if (!(Test-PrivateIPv4 $address) -or $ips -notcontains $address) {
            throw 'The IP SAN must cover the active private address. Use -ListenAddress on a multi-interface PC.'
        }
    }
    $chain = [Text.StringBuilder]::new()
    $selected = [Security.Cryptography.X509Certificates.X509Certificate2Collection]::new()
    $seen = @{}
    $cert = $leaf
    while ($null -ne $cert -and !$seen.ContainsKey($cert.Thumbprint)) {
        if ($cert.NotBefore -gt [DateTime]::Now -or $cert.NotAfter -le [DateTime]::Now) { throw 'The certificate is outside its validity period.' }
        $seen[$cert.Thumbprint] = $true
        [void]$selected.Add($cert)
        [void]$chain.AppendLine('-----BEGIN CERTIFICATE-----')
        [void]$chain.AppendLine([Convert]::ToBase64String($cert.RawData, 'InsertLineBreaks'))
        [void]$chain.AppendLine('-----END CERTIFICATE-----')
        if ($cert.Subject -eq $cert.Issuer) { break }
        $parent = @($certificates | Where-Object { $_.Subject -eq $cert.Issuer })
        if ($parent.Count -gt 1) { throw 'The PFX contains ambiguous intermediate certificates.' }
        $cert = $parent | Select-Object -First 1
    }
    $verification = [Security.Cryptography.X509Certificates.X509Chain]::new()
    try {
        $verification.ChainPolicy.RevocationMode = 'NoCheck'
        $verification.ChainPolicy.VerificationFlags = 'AllowUnknownCertificateAuthority'
        $verification.ChainPolicy.UrlRetrievalTimeout = [TimeSpan]::FromSeconds(2)
        [void]$verification.ChainPolicy.ApplicationPolicy.Add([Security.Cryptography.Oid]::new('1.3.6.1.5.5.7.3.1'))
        $verification.ChainPolicy.ExtraStore.AddRange($selected)
        if (!$verification.Build($leaf) -or $verification.ChainElements.Count -lt $selected.Count) { throw 'Invalid TLS certificate chain.' }
        for ($i = 0; $i -lt $selected.Count; $i++) {
            if ($verification.ChainElements[$i].Certificate.Thumbprint -ne $selected[$i].Thumbprint) { throw 'Invalid TLS certificate chain order.' }
        }
    } finally { $verification.Dispose() }
    # Export exactly the chain printed above; Windows PowerShell 5.1 never needs plaintext PEM.
    $plain = $selected.Export('Pfx', '')
    if (!$plain -or $plain.Length -gt 65536) { throw 'The TLS identity exceeds the supported size.' }
    $encrypted = [Security.Cryptography.ProtectedData]::Protect($plain, $null, 'CurrentUser')
    $marker = $target + '.required'
    if (![IO.File]::Exists($marker)) {
        try { [IO.File]::Open($marker, 'CreateNew', 'Write', 'Read').Dispose() }
        catch [IO.IOException] { if (![IO.File]::Exists($marker)) { throw } }
    }
    Assert-RegularPath $marker $false
    [void][IO.Directory]::CreateDirectory($target)
    Assert-RegularPath $target $true
    $identity = Join-Path $target 'private-key.dpapi'
    $stage = Join-Path $target ('identity-' + [Guid]::NewGuid().ToString('N') + '.tmp')
    $output = [IO.File]::Open($stage, 'CreateNew', 'Write', 'None')
    try {
        $pem = [Text.Encoding]::ASCII.GetBytes($chain.ToString())
        $output.Write($pem, 0, $pem.Length)
        $output.WriteByte(0)
        $output.Write($encrypted, 0, $encrypted.Length)
        $output.Flush($true)
    } finally { $output.Dispose() }
    if ([IO.File]::Exists($identity)) {
        Assert-RegularPath $identity $false
        [IO.File]::Replace($stage, $identity, [Management.Automation.Language.NullString]::Value)
    } else { [IO.File]::Move($stage, $identity) }
    $stage = $null
} finally {
    if ($plain) { [Array]::Clear($plain, 0, $plain.Length) }
    foreach ($cert in $certificates) { $cert.Dispose() }
    if ($stage -and [IO.File]::Exists($stage)) { [IO.File]::Delete($stage) }
}

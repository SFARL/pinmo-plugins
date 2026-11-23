# Pinmo import tool for Windows

This is the `import-folder` skill's tool on Windows 10 and 11. It does what the `pinmo` command-line tool does (same commands, same output, same exit codes) using only what ships with Windows:

- Windows PowerShell 5.1 runs it.
- The .NET Framework's WPF imaging reads each photo's capture time, time zone and GPS, turns the pixels upright, and makes the two resized copies.
- `HttpClient` talks to Pinmo, and a listener on 127.0.0.1 catches the browser's answer at login.

The original photos never leave the computer: only the two copies are uploaded, with every APP1 (Exif, XMP) and APP13 (IPTC) block removed, plus the capture time and GPS read here. The login is kept in `%USERPROFILE%\.config\pinmo\credentials.json` (or under `XDG_CONFIG_HOME` when that is set), the same file the `pinmo` CLI uses, in a folder only the current user can open. Tokens stay in that file and in memory; they are never printed or passed on a command line.

## Run it

Copy the code block below into a new private folder as `pinmo.ps1` and run it. `SKILL.md` gives the exact commands. The extraction keeps the lines between the line ```` ```powershell pinmo ```` and the next line that is exactly ```` ``` ````. `-ExecutionPolicy Bypass` applies to this one PowerShell process only.

```
powershell -NoProfile -ExecutionPolicy Bypass -File "<folder>\pinmo.ps1" <command> [arguments] [--origin <url>]
```

The commands are `login [--no-browser]`, `import <folder> [--agent-fills]`, `drafts <import-id> <folder>`, `suggest <draft-id> --place <name> [--tag <tag>]...`, `status <import-id>`, `logout` and `help`. Two more, `meta <photo>` and `variant <photo> <out.jpg> display|thumb`, print what the tool reads from one photo or write one resized copy, so the result can be checked without uploading anything.

```powershell pinmo
# Pinmo import tool for Windows PowerShell 5.1. Mirrors the pinmo CLI: same commands, output and exit codes.
# This file is ASCII on purpose: Windows PowerShell reads a script without a byte order mark in the system code page.
$ErrorActionPreference = 'Stop'
$Argv = @($args)

Add-Type -AssemblyName System.Net.Http
Add-Type -AssemblyName PresentationCore
Add-Type -AssemblyName WindowsBase
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

$DefaultOrigin = 'https://pinmo.me'
$AgentApiPath = '/agent-api'
$Limits = @{ display = @{ MaxEdge = 2048; Quality = 82 }; thumb = @{ MaxEdge = 400; Quality = 75 } }
$MaxPhotosPerImport = 200
$MaxRetries = 6
$Utf8 = New-Object System.Text.UTF8Encoding($false)
$Invariant = [Globalization.CultureInfo]::InvariantCulture
$EnDash = [string][char]0x2013

$Usage = @(
  "Usage: pinmo <command> [--origin <url>]   (default origin $DefaultOrigin)",
  '',
  'Commands:',
  '  pinmo login [--no-browser]          Allow this computer to import photos into your Pinmo account',
  '                                      (--no-browser: only print the address, e.g. over SSH)',
  '  pinmo import <folder> [--agent-fills]',
  "                                      Import the folder's JPEGs as drafts, sorted into cards",
  "  pinmo drafts <import-id> <folder>   List the import's drafts with their files in the folder",
  '  pinmo suggest <draft-id> --place <name> [--tag <tag>]...',
  '                                      Suggest a place name (and base tags) for one draft',
  "  pinmo status <import-id>            Show the import's cards again",
  "  pinmo logout                        Forget this computer's login",
  '',
  'For an agent organizing a folder into a map:',
  '  1. pinmo login (once; the user allows it in the browser)',
  "  2. pinmo import <folder> --agent-fills   (Pinmo's own model stays off for this import)",
  "  3. pinmo drafts <import-id> <folder>, then look at each draft's photos",
  '  4. pinmo suggest <draft-id> --place "<shop name>" for each place you recognize; skip the ones you are unsure of',
  '  5. pinmo status <import-id>, then tell the user which drafts still need a place and give them the review address.',
  'The user checks and confirms every card on the web; nothing is confirmed or shared from here.'
) -join "`n"

$LoginMessages = @{
  declined = 'Login was declined in the browser.'
  state = "The browser's answer was not for this login. Run pinmo login again."
  timeout = 'No answer from the browser within 5 minutes. Run pinmo login again.'
  client = 'This Pinmo site does not offer CLI login (agent import is switched off).'
  exchange = 'The site did not hand out a token. Run pinmo login again.'
}
$NeedLogin = 'The login has run out or was revoked. Run pinmo login again.'
$TooBusy = 'The site is busy. Wait a minute and run the command again.'
$CallbackPage = 'Pinmo CLI got the answer. You can close this window and go back to the terminal.'

# ---------- small helpers ----------

$StdOut = [Console]::OpenStandardOutput()
$StdErr = [Console]::OpenStandardError()
function Write-Line($stream, [string]$text) {
  $bytes = $Utf8.GetBytes($text + "`n")
  $stream.Write($bytes, 0, $bytes.Length)
  $stream.Flush()
}
function Out([string]$text) { Write-Line $StdOut $text }
function Err([string]$text) { Write-Line $StdErr $text }

function Stop-Pinmo([string]$message, [int]$code) {
  $e = New-Object System.Exception $message
  $e.Data['pinmo'] = $code
  throw $e
}

function Get-Env([string]$name) {
  $value = [Environment]::GetEnvironmentVariable($name)
  if ([string]::IsNullOrEmpty($value)) { return $null }
  return $value
}

function To-Base64Url([byte[]]$bytes) {
  return [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}

function New-RandomBase64Url([int]$count) {
  $bytes = New-Object byte[] $count
  $rng = New-Object System.Security.Cryptography.RNGCryptoServiceProvider
  $rng.GetBytes($bytes)
  $rng.Dispose()
  return To-Base64Url $bytes
}

function Get-Sha256Bytes([byte[]]$bytes) {
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try { return $sha.ComputeHash($bytes) } finally { $sha.Dispose() }
}

function Get-FileSha256([string]$path) {
  $sha = [System.Security.Cryptography.SHA256]::Create()
  $stream = [IO.File]::OpenRead($path)
  try {
    $hash = $sha.ComputeHash($stream)
  } finally {
    $stream.Dispose()
    $sha.Dispose()
  }
  return (($hash | ForEach-Object { $_.ToString('x2') }) -join '')
}

function Get-Origin([string]$text) {
  $uri = $null
  if (-not [Uri]::TryCreate($text, [UriKind]::Absolute, [ref]$uri)) { Stop-Pinmo $Usage 2 }
  return $uri.GetLeftPart([UriPartial]::Authority).ToLowerInvariant()
}

function Escape-Json([string]$text) {
  $builder = New-Object System.Text.StringBuilder
  foreach ($ch in $text.ToCharArray()) {
    $code = [int]$ch
    if ($ch -eq '"') { [void]$builder.Append('\"') }
    elseif ($ch -eq '\') { [void]$builder.Append('\\') }
    elseif ($code -lt 32) { [void]$builder.Append('\u' + $code.ToString('x4')) }
    else { [void]$builder.Append($ch) }
  }
  return '"' + $builder.ToString() + '"'
}

function ConvertTo-PinmoJson($value) {
  if ($null -eq $value) { return 'null' }
  if ($value -is [string]) { return Escape-Json $value }
  if ($value -is [bool]) { if ($value) { return 'true' } else { return 'false' } }
  if ($value -is [double] -or $value -is [single]) { return ([double]$value).ToString('R', $Invariant) }
  if ($value -is [int] -or $value -is [long] -or $value -is [decimal] -or $value -is [uint32] -or $value -is [uint64] -or $value -is [int16] -or $value -is [uint16]) {
    return $value.ToString($Invariant)
  }
  if ($value -is [System.Collections.IDictionary]) {
    $parts = foreach ($key in $value.Keys) { (Escape-Json ([string]$key)) + ':' + (ConvertTo-PinmoJson $value[$key]) }
    return '{' + ($parts -join ',') + '}'
  }
  if ($value -is [System.Management.Automation.PSCustomObject]) {
    $parts = foreach ($prop in $value.PSObject.Properties) { (Escape-Json $prop.Name) + ':' + (ConvertTo-PinmoJson $prop.Value) }
    return '{' + ($parts -join ',') + '}'
  }
  if ($value -is [System.Collections.IEnumerable]) {
    $parts = foreach ($item in $value) { ConvertTo-PinmoJson $item }
    return '[' + ($parts -join ',') + ']'
  }
  return Escape-Json ([string]$value)
}

function ConvertFrom-PinmoJson([string]$text) {
  if ([string]::IsNullOrWhiteSpace($text)) { return $null }
  try { return ($text | ConvertFrom-Json) } catch { return $null }
}

# ---------- files ----------

function Get-ConfigDir {
  $base = Get-Env 'XDG_CONFIG_HOME'
  if (-not $base) { $base = Join-Path ([Environment]::GetFolderPath('UserProfile')) '.config' }
  return Join-Path $base 'pinmo'
}

function Protect-Folder([string]$path) {
  if (-not (Test-Path -LiteralPath $path)) { [void](New-Item -ItemType Directory -Path $path -Force) }
  try {
    $me = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
    $acl = New-Object System.Security.AccessControl.DirectorySecurity
    $acl.SetAccessRuleProtection($true, $false)
    $inherit = [System.Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit'
    $rule = New-Object System.Security.AccessControl.FileSystemAccessRule($me, 'FullControl', $inherit, 'None', 'Allow')
    $acl.AddAccessRule($rule)
    [System.IO.Directory]::SetAccessControl($path, $acl)
  } catch {
    # The folder sits in the user's own profile, which other users cannot open anyway.
  }
}

function Read-JsonFile([string]$path) {
  $stored = [ordered]@{}
  if (-not (Test-Path -LiteralPath $path)) { return $stored }
  $parsed = ConvertFrom-PinmoJson ([IO.File]::ReadAllText($path, $Utf8))
  if ($parsed -is [System.Management.Automation.PSCustomObject]) {
    foreach ($prop in $parsed.PSObject.Properties) { $stored[$prop.Name] = $prop.Value }
  }
  return $stored
}

function Write-JsonFile([string]$path, $stored) {
  Protect-Folder (Get-ConfigDir)
  [IO.File]::WriteAllText($path, (ConvertTo-PinmoJson $stored) + "`n", $Utf8)
}

function Get-CredentialsPath { Join-Path (Get-ConfigDir) 'credentials.json' }
function Get-OpenImportsPath { Join-Path (Get-ConfigDir) 'open-imports.json' }

function Get-Credentials([string]$origin) {
  $stored = Read-JsonFile (Get-CredentialsPath)
  if (-not $stored.Contains($origin)) { return $null }
  $c = $stored[$origin]
  return [ordered]@{ origin = [string]$c.origin; clientId = [string]$c.clientId; accessToken = [string]$c.accessToken; refreshToken = [string]$c.refreshToken; expiresAt = [long]$c.expiresAt }
}
function Save-Credentials($creds) {
  $stored = Read-JsonFile (Get-CredentialsPath)
  $stored[$creds.origin] = $creds
  Write-JsonFile (Get-CredentialsPath) $stored
}
function Remove-Credentials([string]$origin) {
  $stored = Read-JsonFile (Get-CredentialsPath)
  if ($stored.Contains($origin)) { $stored.Remove($origin) }
  Write-JsonFile (Get-CredentialsPath) $stored
}
function Get-OpenImport([string]$origin) {
  $stored = Read-JsonFile (Get-OpenImportsPath)
  if ($stored.Contains($origin)) { return [string]$stored[$origin] }
  return $null
}
function Save-OpenImport([string]$origin, $importId) {
  $stored = Read-JsonFile (Get-OpenImportsPath)
  if ($stored.Contains($origin)) { $stored.Remove($origin) }
  if ($importId) { $stored[$origin] = [string]$importId }
  Write-JsonFile (Get-OpenImportsPath) $stored
}

function Join-Folder([string]$dir, [string]$name) {
  return [IO.Path]::Combine($dir.TrimEnd('\', '/'), $name)
}

function Get-FolderFiles([string]$dir) {
  if (-not [IO.Directory]::Exists($dir)) { Stop-Pinmo "No such folder: $dir" 1 }
  [string[]]$names = @((New-Object IO.DirectoryInfo $dir).GetFiles() | ForEach-Object { $_.Name })
  [Array]::Sort($names, [StringComparer]::Ordinal)
  return ,$names
}

function Get-ModifiedMs([string]$path) {
  $ticks = [long]([IO.File]::GetLastWriteTimeUtc($path).Ticks - 621355968000000000)
  return [long](($ticks - ($ticks % 10000)) / 10000)
}

# ---------- HTTP ----------

$Handler = New-Object System.Net.Http.HttpClientHandler
$Handler.AllowAutoRedirect = $false
$Client = New-Object System.Net.Http.HttpClient($Handler)
$Client.Timeout = [TimeSpan]::FromMinutes(2)

function Invoke-Pinmo([string]$method, [string]$url, $token, $json, $form, [byte[]]$jpeg) {
  $request = New-Object System.Net.Http.HttpRequestMessage((New-Object System.Net.Http.HttpMethod $method), $url)
  if ($token) { $request.Headers.Authorization = New-Object System.Net.Http.Headers.AuthenticationHeaderValue('Bearer', $token) }
  if ($null -ne $json) {
    $request.Content = New-Object System.Net.Http.StringContent((ConvertTo-PinmoJson $json), $Utf8, 'application/json')
  } elseif ($null -ne $form) {
    $pairs = New-Object 'System.Collections.Generic.List[System.Collections.Generic.KeyValuePair[string,string]]'
    foreach ($key in $form.Keys) { $pairs.Add((New-Object 'System.Collections.Generic.KeyValuePair[string,string]' ([string]$key), ([string]$form[$key]))) }
    $request.Content = New-Object System.Net.Http.FormUrlEncodedContent(,$pairs)
  } elseif ($null -ne $jpeg) {
    $request.Content = New-Object System.Net.Http.ByteArrayContent(,$jpeg)
    $request.Content.Headers.ContentType = New-Object System.Net.Http.Headers.MediaTypeHeaderValue('image/jpeg')
  } elseif ($method -ne 'GET') {
    $request.Content = New-Object System.Net.Http.ByteArrayContent(,(New-Object byte[] 0))
  }
  try {
    $response = $Client.SendAsync($request).GetAwaiter().GetResult()
    $bytes = $response.Content.ReadAsByteArrayAsync().GetAwaiter().GetResult()
  } catch {
    $site = ([Uri]$url).GetLeftPart([UriPartial]::Authority)
    Stop-Pinmo "Could not reach $site. Check the connection and try again." 1
  }
  return @{ Status = [int]$response.StatusCode; Body = (ConvertFrom-PinmoJson ($Utf8.GetString($bytes))) }
}

function ConvertTo-Credentials($res, [string]$origin, [string]$clientId) {
  if ($res.Status -lt 200 -or $res.Status -gt 299 -or $null -eq $res.Body) { return $null }
  if (-not $res.Body.access_token -or -not $res.Body.refresh_token) { return $null }
  $expiresIn = 0
  if ($res.Body.PSObject.Properties['expires_in']) { $expiresIn = [long]$res.Body.expires_in }
  $now = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  return [ordered]@{ origin = $origin; clientId = $clientId; accessToken = [string]$res.Body.access_token; refreshToken = [string]$res.Body.refresh_token; expiresAt = [long]($now + $expiresIn * 1000) }
}

# Calls the agent API like the CLI: a 401 refreshes the token once and retries; rate_limited waits and retries.
$Script:Creds = $null
function Invoke-Agent([string]$method, [string]$path, $json, [byte[]]$jpeg) {
  $resource = $Script:Creds.origin + $AgentApiPath
  $wait = 10000
  if (Get-Env 'PINMO_RETRY_WAIT_MS') { $wait = [int](Get-Env 'PINMO_RETRY_WAIT_MS') }
  $refreshed = $false
  $retries = 0
  while ($true) {
    $res = Invoke-Pinmo $method ($resource + $path) $Script:Creds.accessToken $json $null $jpeg
    if ($res.Status -eq 401) {
      if ($refreshed) { Stop-Pinmo $NeedLogin 1 }
      $form = [ordered]@{ grant_type = 'refresh_token'; refresh_token = $Script:Creds.refreshToken; client_id = $Script:Creds.clientId; resource = $resource }
      $fresh = ConvertTo-Credentials (Invoke-Pinmo 'POST' ($Script:Creds.origin + '/oauth/token') $null $null $form $null) $Script:Creds.origin $Script:Creds.clientId
      if ($null -eq $fresh) { Stop-Pinmo $NeedLogin 1 }
      $Script:Creds = $fresh
      Save-Credentials $fresh
      $refreshed = $true
      continue
    }
    if ($res.Status -eq 429 -and $null -ne $res.Body -and $res.Body.error -eq 'rate_limited') {
      if ($retries -eq $MaxRetries) { Stop-Pinmo $TooBusy 1 }
      $retries += 1
      Start-Sleep -Milliseconds $wait
      continue
    }
    return $res
  }
}

# ---------- login ----------

function Send-Answer($client, [string]$status, [string]$body) {
  $bytes = $Utf8.GetBytes($body)
  $head = "HTTP/1.1 $status`r`nContent-Type: text/plain; charset=utf-8`r`nConnection: close`r`nContent-Length: $($bytes.Length)`r`n`r`n"
  $stream = $client.GetStream()
  $headBytes = [Text.Encoding]::ASCII.GetBytes($head)
  $stream.Write($headBytes, 0, $headBytes.Length)
  $stream.Write($bytes, 0, $bytes.Length)
  $stream.Flush()
}

# Waits on 127.0.0.1 for the browser's answer; every request gets a reply, and the first /callback query is kept.
function Wait-Callback($listener, [int]$timeoutMs) {
  $deadline = [DateTime]::UtcNow.AddMilliseconds($timeoutMs)
  while ([DateTime]::UtcNow -lt $deadline) {
    if (-not $listener.Pending()) { Start-Sleep -Milliseconds 100; continue }
    $client = $listener.AcceptTcpClient()
    try {
      $stream = $client.GetStream()
      $stream.ReadTimeout = 2000
      $buffer = New-Object byte[] 8192
      $text = ''
      try {
        while ($text.IndexOf("`r`n") -lt 0) {
          $read = $stream.Read($buffer, 0, $buffer.Length)
          if ($read -le 0) { break }
          $text += [Text.Encoding]::ASCII.GetString($buffer, 0, $read)
        }
      } catch {
        continue
      }
      $line = ($text -split "`r`n")[0]
      if ($line -match '^GET /callback(?:\?([^ ]*))? HTTP/') {
        $query = $Matches[1]
        Send-Answer $client '200 OK' $CallbackPage
        $params = @{}
        if ($query) {
          foreach ($pair in $query.Split('&')) {
            if (-not $pair) { continue }
            $kv = $pair.Split('=', 2)
            $value = ''
            if ($kv.Length -gt 1) { $value = [Uri]::UnescapeDataString($kv[1].Replace('+', ' ')) }
            $params[[Uri]::UnescapeDataString($kv[0].Replace('+', ' '))] = $value
          }
        }
        return $params
      }
      Send-Answer $client '404 Not Found' 'Not found'
    } finally {
      $client.Close()
    }
  }
  return $null
}

function Invoke-Login([string]$origin, [bool]$openBrowser) {
  $client = Invoke-Pinmo 'GET' ($origin + '/oauth/clients/pinmo-cli') $null $null $null $null
  $clientId = $null
  if ($client.Status -eq 200 -and $null -ne $client.Body) { $clientId = [string]$client.Body.client_id }
  if (-not $clientId) { Stop-Pinmo $LoginMessages.client 1 }
  $verifier = New-RandomBase64Url 32
  $state = New-RandomBase64Url 24
  $challenge = To-Base64Url (Get-Sha256Bytes ([Text.Encoding]::ASCII.GetBytes($verifier)))
  $listener = New-Object System.Net.Sockets.TcpListener([Net.IPAddress]::Loopback, 0)
  $listener.Start()
  try {
    $redirectUri = "http://127.0.0.1:$($listener.LocalEndpoint.Port)/callback"
    $resource = $origin + $AgentApiPath
    $query = [ordered]@{ response_type = 'code'; client_id = $clientId; redirect_uri = $redirectUri; scope = 'photos.import'; state = $state; code_challenge = $challenge; code_challenge_method = 'S256'; resource = $resource }
    $address = $origin + '/oauth/authorize?' + (($query.Keys | ForEach-Object { [Uri]::EscapeDataString($_) + '=' + [Uri]::EscapeDataString($query[$_]) }) -join '&')
    Out 'Open this address to let Pinmo CLI import photos into your account:'
    Out $address
    if ($openBrowser) { Start-Process $address }
    $timeout = 300000
    if (Get-Env 'PINMO_LOGIN_TIMEOUT_MS') { $timeout = [int](Get-Env 'PINMO_LOGIN_TIMEOUT_MS') }
    $answer = Wait-Callback $listener $timeout
  } finally {
    $listener.Stop()
  }
  if ($null -eq $answer) { Stop-Pinmo $LoginMessages.timeout 1 }
  if ($answer['state'] -ne $state) { Stop-Pinmo $LoginMessages.state 1 }
  if (-not $answer['code']) { Stop-Pinmo $LoginMessages.declined 1 }
  $form = [ordered]@{ grant_type = 'authorization_code'; code = $answer['code']; client_id = $clientId; redirect_uri = $redirectUri; code_verifier = $verifier; resource = $resource }
  $creds = ConvertTo-Credentials (Invoke-Pinmo 'POST' ($origin + '/oauth/token') $null $null $form $null) $origin $clientId
  if ($null -eq $creds) { Stop-Pinmo $LoginMessages.exchange 1 }
  return $creds
}

# ---------- photos ----------

function Get-Query($metadata, [string]$query) {
  if ($null -eq $metadata) { return $null }
  try { return $metadata.GetQuery($query) } catch { return $null }
}

function Get-WallClockMs($value) {
  if (-not ($value -is [string])) { return $null }
  if ($value -notmatch '^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})') { return $null }
  $y = [int]$Matches[1]; $mo = [int]$Matches[2]; $d = [int]$Matches[3]
  if ($y -lt 1900 -or $mo -lt 1 -or $mo -gt 12 -or $d -lt 1 -or $d -gt 31) { return $null }
  # Like JavaScript's Date.UTC: days past the end of a month roll into the next one.
  $at = (New-Object DateTime($y, $mo, 1, 0, 0, 0, [DateTimeKind]::Utc)).AddDays($d - 1).AddHours([int]$Matches[4]).AddMinutes([int]$Matches[5]).AddSeconds([int]$Matches[6])
  return [DateTimeOffset]::new($at).ToUnixTimeMilliseconds()
}

function Get-OffsetMin($value) {
  if (-not ($value -is [string])) { return $null }
  if ($value -notmatch '^([+-])(\d{2}):(\d{2})$') { return $null }
  $sign = 1
  if ($Matches[1] -eq '-') { $sign = -1 }
  return [int]($sign * ([int]$Matches[2] * 60 + [int]$Matches[3]))
}

function Get-DeviceOffsetMin([long]$atMs) {
  $utc = [DateTimeOffset]::FromUnixTimeMilliseconds($atMs).UtcDateTime
  return [int][TimeZoneInfo]::Local.GetUtcOffset($utc).TotalMinutes
}

function Get-Degrees($value, $ref, [string]$negative) {
  if ($null -eq $value -or $value.Length -lt 3) { return $null }
  $mask = [uint64]4294967295
  $parts = foreach ($v in $value) { $n = [uint64]$v; [double]($n -band $mask) / [double]($n -shr 32) }
  $degrees = $parts[0] + $parts[1] / 60 + $parts[2] / 3600
  if ([double]::IsNaN($degrees) -or [double]::IsInfinity($degrees)) { return $null }
  if ([string]$ref -eq $negative) { return -$degrees }
  return $degrees
}

# Capture time, time zone and GPS, by the web app's rules (src/shared/photo-meta.ts).
function Read-Meta([string]$path) {
  $date = $null; $offsetText = $null; $lat = $null; $lng = $null
  $stream = [IO.File]::OpenRead($path)
  try {
    $frame = [Windows.Media.Imaging.BitmapFrame]::Create($stream, [Windows.Media.Imaging.BitmapCreateOptions]::DelayCreation, [Windows.Media.Imaging.BitmapCacheOption]::None)
    $metadata = $frame.Metadata
    $date = Get-Query $metadata '/app1/ifd/exif/{ushort=36867}'
    $offsetText = Get-Query $metadata '/app1/ifd/exif/{ushort=36881}'
    $lat = Get-Degrees (Get-Query $metadata '/app1/ifd/gps/{ushort=2}') (Get-Query $metadata '/app1/ifd/gps/{ushort=1}') 'S'
    $lng = Get-Degrees (Get-Query $metadata '/app1/ifd/gps/{ushort=4}') (Get-Query $metadata '/app1/ifd/gps/{ushort=3}') 'W'
  } catch {
    # Unreadable metadata is normal for screenshots and edited photos.
  } finally {
    $stream.Dispose()
  }
  $meta = [ordered]@{}
  $wall = Get-WallClockMs $date
  if ($null -eq $wall) {
    $modified = Get-ModifiedMs $path
    $meta.takenAt = $modified
    $meta.tzOffsetMin = Get-DeviceOffsetMin $modified
    $meta.takenAtSource = 'file_mtime'
  } else {
    $offset = Get-OffsetMin $offsetText
    if ($null -eq $offset) { $offset = Get-DeviceOffsetMin $wall }
    $meta.takenAt = [long]($wall - [long]$offset * 60000)
    $meta.tzOffsetMin = $offset
    $meta.takenAtSource = 'exif'
  }
  if ($null -ne $lat -and $null -ne $lng) { $meta.lat = $lat; $meta.lng = $lng }
  return $meta
}

# Drops APP1 (Exif, XMP) and APP13 (IPTC) blocks; the server refuses a copy that still has one.
function Remove-Metadata([byte[]]$bytes) {
  if ($bytes.Length -lt 4 -or $bytes[0] -ne 0xff -or $bytes[1] -ne 0xd8) { Stop-Pinmo 'decode' 1 }
  $kept = New-Object IO.MemoryStream
  $kept.Write($bytes, 0, 2)
  $i = 2
  while ($i + 4 -le $bytes.Length) {
    if ($bytes[$i] -ne 0xff) { break }
    $marker = $bytes[$i + 1]
    if ($marker -eq 0xda) {
      $kept.Write($bytes, $i, $bytes.Length - $i)
      return ,$kept.ToArray()
    }
    $end = $i + 2 + ([int]$bytes[$i + 2] * 256 + [int]$bytes[$i + 3])
    if ($end -gt $bytes.Length) { break }
    if ($marker -ne 0xe1 -and $marker -ne 0xed) { $kept.Write($bytes, $i, $end - $i) }
    $i = $end
  }
  Stop-Pinmo 'decode' 1
}

function Get-OrientationTransform([int]$orientation) {
  $group = New-Object System.Windows.Media.TransformGroup
  switch ($orientation) {
    2 { $group.Children.Add((New-Object System.Windows.Media.ScaleTransform(-1, 1))) }
    3 { $group.Children.Add((New-Object System.Windows.Media.RotateTransform(180))) }
    4 { $group.Children.Add((New-Object System.Windows.Media.ScaleTransform(1, -1))) }
    5 { $group.Children.Add((New-Object System.Windows.Media.RotateTransform(90))); $group.Children.Add((New-Object System.Windows.Media.ScaleTransform(-1, 1))) }
    6 { $group.Children.Add((New-Object System.Windows.Media.RotateTransform(90))) }
    7 { $group.Children.Add((New-Object System.Windows.Media.RotateTransform(270))); $group.Children.Add((New-Object System.Windows.Media.ScaleTransform(-1, 1))) }
    8 { $group.Children.Add((New-Object System.Windows.Media.RotateTransform(270))) }
    default { return $null }
  }
  return $group
}

# One upright copy as JPEG bytes, its long edge at most the variant's limit (never larger than the photo), without metadata.
function New-Variant([string]$path, [string]$variant) {
  $limit = $Limits[$variant]
  try {
    $bytes = [IO.File]::ReadAllBytes($path)
    $probe = New-Object IO.MemoryStream(,$bytes)
    $frame = [Windows.Media.Imaging.BitmapFrame]::Create($probe, [Windows.Media.Imaging.BitmapCreateOptions]::DelayCreation, [Windows.Media.Imaging.BitmapCacheOption]::OnLoad)
    $width = $frame.PixelWidth
    $height = $frame.PixelHeight
    $orientation = 1
    $tag = Get-Query $frame.Metadata '/app1/ifd/{ushort=274}'
    if ($null -ne $tag) { $orientation = [int]$tag }
    $long = [Math]::Max($width, $height)
    $target = [Math]::Min($limit.MaxEdge, $long)
    $image = New-Object Windows.Media.Imaging.BitmapImage
    $image.BeginInit()
    $image.CacheOption = [Windows.Media.Imaging.BitmapCacheOption]::OnLoad
    $image.CreateOptions = [Windows.Media.Imaging.BitmapCreateOptions]::IgnoreColorProfile
    $image.StreamSource = New-Object IO.MemoryStream(,$bytes)
    if ($target -lt $long) {
      $image.DecodePixelWidth = [int][Math]::Floor($width * $target / $long + 0.5)
      $image.DecodePixelHeight = [int][Math]::Floor($height * $target / $long + 0.5)
    }
    $image.EndInit()
    $image.Freeze()
    $bitmap = [Windows.Media.Imaging.BitmapSource]$image
    $transform = Get-OrientationTransform $orientation
    if ($null -ne $transform) { $bitmap = New-Object Windows.Media.Imaging.TransformedBitmap($bitmap, $transform) }
    $bitmap = New-Object Windows.Media.Imaging.FormatConvertedBitmap($bitmap, [Windows.Media.PixelFormats]::Bgr24, $null, 0)
    $encoder = New-Object Windows.Media.Imaging.JpegBitmapEncoder
    $encoder.QualityLevel = $limit.Quality
    $encoder.Frames.Add([Windows.Media.Imaging.BitmapFrame]::Create($bitmap))
    $encoded = New-Object IO.MemoryStream
    $encoder.Save($encoded)
    return ,(Remove-Metadata $encoded.ToArray())
  } catch {
    Stop-Pinmo 'decode' 1
  }
}

# ---------- commands ----------

function Get-ErrorCode($body) {
  if ($null -ne $body -and $body.PSObject.Properties['error'] -and $body.error) { return [string]$body.error }
  return 'error'
}

function Format-Summary($report, $view, [string]$origin) {
  $lines = New-Object System.Collections.Generic.List[string]
  if ($null -ne $report) {
    $lines.Add("Uploaded: $($report.uploaded)")
    $lines.Add("Skipped: $($report.unsupported) not JPEG (export HEIC as JPEG first), $($report.saved) already saved, $($report.failed.Count) failed")
    foreach ($failure in $report.failed) { $lines.Add("  $($failure.file): $($failure.reason)") }
  }
  $lines.Add("Cards: $($view.cards) ($($view.needPlace) need a place, $($view.needTime) need a time)")
  $lines.Add("Review and confirm: $origin/imports/$($view.id)")
  return ($lines -join "`n")
}

function Send-Photo([string]$path, [string]$importId) {
  $request = [ordered]@{ sha256 = Get-FileSha256 $path }
  $meta = Read-Meta $path
  foreach ($key in $meta.Keys) { $request[$key] = $meta[$key] }
  $request.importId = $importId
  $created = Invoke-Agent 'POST' '/photos' $request $null
  if ($created.Status -ne 200 -and $created.Status -ne 201) { return @{ reason = Get-ErrorCode $created.Body } }
  $state = $created.Body
  if ($state.used) { return 'saved' }
  $missing = @($state.missing)
  if ($missing.Count -eq 0) { return 'uploaded' }
  $made = @{}
  try {
    foreach ($variant in $missing) { $made[$variant] = New-Variant $path $variant }
  } catch {
    if ($_.Exception.Data.Contains('pinmo')) { return @{ reason = 'decode' } }
    throw
  }
  foreach ($variant in $missing) {
    $put = Invoke-Agent 'PUT' "/photos/$($state.photoId)/$variant" $null $made[$variant]
    if ($put.Status -ne 200) { return @{ reason = Get-ErrorCode $put.Body } }
  }
  return 'uploaded'
}

function Invoke-Import([string]$dir, [bool]$agentFills, [string]$origin) {
  $names = Get-FolderFiles $dir
  $visible = @($names | Where-Object { -not $_.StartsWith('.') })
  $jpegs = @($visible | Where-Object { $_ -match '\.jpe?g$' })
  $others = $visible.Count - $jpegs.Count
  if ($jpegs.Count -eq 0) { Stop-Pinmo 'No JPEG in that folder (HEIC needs exporting as JPEG first).' 1 }
  if ($jpegs.Count -gt $MaxPhotosPerImport) { Stop-Pinmo 'More than 200 JPEGs: split the folder and import each part.' 1 }
  $body = [ordered]@{ total = $jpegs.Count; tzOffsetMin = Get-DeviceOffsetMin ([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()) }
  if ($agentFills) { $body.agentFills = $true }
  $opened = Invoke-Agent 'POST' '/imports' $body $null
  if ($opened.Status -ne 200 -and $opened.Status -ne 201) {
    $code = "http_$($opened.Status)"
    if ($null -ne $opened.Body -and $opened.Body.PSObject.Properties['error'] -and $opened.Body.error) { $code = [string]$opened.Body.error }
    Stop-Pinmo "The import could not be opened ($code)." 1
  }
  $importId = [string]$opened.Body.id
  if ($opened.Status -eq 200 -and $importId -ne (Get-OpenImport $origin)) {
    Stop-Pinmo 'An import is still open on the web. Finish or leave it there first, then import again.' 1
  }
  if ($opened.Status -eq 201) { Save-OpenImport $origin $importId }
  $report = @{ uploaded = 0; unsupported = $others; saved = 0; failed = (New-Object System.Collections.ArrayList) }
  foreach ($name in $jpegs) {
    $outcome = Send-Photo (Join-Folder $dir $name) $importId
    if ($outcome -is [string] -and $outcome -eq 'uploaded') { $report.uploaded += 1 }
    elseif ($outcome -is [string] -and $outcome -eq 'saved') { $report.saved += 1 }
    else { [void]$report.failed.Add(@{ file = $name; reason = $outcome.reason }) }
  }
  $completed = Invoke-Agent 'POST' "/imports/$importId/complete" $null $null
  if ($completed.Status -eq 200) { Save-OpenImport $origin $null }
  [void](Invoke-Agent 'POST' "/imports/$importId/auto-cards" $null $null)
  $view = (Invoke-Agent 'GET' "/imports/$importId" $null $null).Body
  Out "Import: $importId"
  Out (Format-Summary $report $view $origin)
}

function Show-Drafts([string]$importId, [string]$dir) {
  $listed = Invoke-Agent 'GET' "/imports/$([Uri]::EscapeDataString($importId))/drafts" $null $null
  if ($listed.Status -ne 200) { Stop-Pinmo 'No such import.' 1 }
  $byHash = @{}
  foreach ($name in (Get-FolderFiles $dir)) {
    if ($name -match '\.jpe?g$' -and -not $name.StartsWith('.')) {
      $path = Join-Folder $dir $name
      $byHash[(Get-FileSha256 $path)] = $path
    }
  }
  $lines = New-Object System.Collections.Generic.List[string]
  foreach ($draft in @($listed.Body.drafts)) {
    $hashes = @($draft.photoSha256s)
    $found = @($hashes | Where-Object { $byHash.ContainsKey([string]$_) } | ForEach-Object { $byHash[[string]$_] })
    $missing = $hashes.Count - $found.Count
    $lacks = @()
    if ($draft.needPlace) { $lacks += 'needs a place' }
    if ($draft.needTime) { $lacks += 'needs a time' }
    $text = $lacks -join ', '
    if (-not $text) { $text = 'ready' }
    $lines.Add("$($draft.id)  $text")
    foreach ($file in $found) { $lines.Add("  $file") }
    if ($missing -gt 0) {
      $plural = 's'
      if ($missing -eq 1) { $plural = '' }
      $lines.Add("  ($missing photo$plural not in this folder)")
    }
  }
  Out ($lines -join "`n")
}

function Send-Suggestion([string]$draftId, [string]$place, $tags) {
  $body = [ordered]@{ placeName = $place }
  if ($tags.Count -gt 0) { $body.tags = [string[]]$tags.ToArray() }
  $res = Invoke-Agent 'PUT' "/experiences/$([Uri]::EscapeDataString($draftId))/suggestion" $body $null
  if ($res.Status -eq 400) { Stop-Pinmo "The name or tags were not accepted (1$($EnDash)100 characters, up to 3 base tags)." 1 }
  if ($res.Status -ne 200) { Stop-Pinmo 'No such draft in one of your imports.' 1 }
  switch ([string]$res.Body.result) {
    'place' { Out "Prefilled the place for $draftId. The user confirms it on the web." }
    'hint' { Out "Kept `"$place`" as a hint for $draftId; no nearby place with that name was found." }
    'kept' { Out "$draftId already has a place; left it as it is." }
  }
}

function Invoke-Logout([string]$origin) {
  $creds = Get-Credentials $origin
  if ($null -eq $creds) { Out "Not logged in to $origin."; return }
  $form = [ordered]@{ token = $creds.refreshToken; token_type_hint = 'refresh_token'; client_id = $creds.clientId }
  [void](Invoke-Pinmo 'POST' ($origin + '/oauth/token') $null $null $form $null)
  Remove-Credentials $origin
  Out "Logged out of $origin."
}

function Invoke-Main([string[]]$argv) {
  $positional = New-Object System.Collections.Generic.List[string]
  $tags = New-Object System.Collections.Generic.List[string]
  $origin = $DefaultOrigin; $place = $null; $agentFills = $false; $noBrowser = $false; $help = $false
  for ($i = 0; $i -lt $argv.Length; $i++) {
    $arg = $argv[$i]
    if ($arg -ceq '--origin') { $i++; $origin = Get-Origin ([string]$argv[$i]) }
    elseif ($arg -ceq '--place') { $i++; $place = [string]$argv[$i] }
    elseif ($arg -ceq '--tag') { $i++; $tags.Add([string]$argv[$i]) }
    elseif ($arg -ceq '--agent-fills') { $agentFills = $true }
    elseif ($arg -ceq '--no-browser') { $noBrowser = $true }
    elseif ($arg -ceq '--help' -or $arg -ceq 'help') { $help = $true }
    else { $positional.Add($arg) }
  }
  $command = $null; $first = $null; $second = $null; $third = $null
  if ($positional.Count -gt 0) { $command = $positional[0] }
  if ($positional.Count -gt 1) { $first = $positional[1] }
  if ($positional.Count -gt 2) { $second = $positional[2] }
  if ($positional.Count -gt 3) { $third = $positional[3] }
  if ($help) { Out $Usage; return }
  if ($command -ceq 'meta' -and $first) {
    $meta = [ordered]@{ sha256 = Get-FileSha256 $first }
    $read = Read-Meta $first
    foreach ($key in $read.Keys) { $meta[$key] = $read[$key] }
    Out (ConvertTo-PinmoJson $meta)
    return
  }
  if ($command -ceq 'variant' -and $first -and $second -and $Limits.ContainsKey([string]$third)) {
    [IO.File]::WriteAllBytes($second, (New-Variant $first $third))
    return
  }
  if ($command -ceq 'login') {
    Save-Credentials (Invoke-Login $origin (-not $noBrowser))
    Out "Logged in to $origin."
    return
  }
  if ($command -ceq 'logout') { Invoke-Logout $origin; return }
  $ready = ($command -ceq 'import' -and $first) -or ($command -ceq 'status' -and $first) -or ($command -ceq 'drafts' -and $first -and $second) -or ($command -ceq 'suggest' -and $first -and $place)
  if (-not $ready) { Stop-Pinmo $Usage 2 }
  $Script:Creds = Get-Credentials $origin
  if ($null -eq $Script:Creds) { Stop-Pinmo "Not logged in to $origin. Run pinmo login first." 1 }
  if ($command -ceq 'import') { Invoke-Import $first $agentFills $origin; return }
  if ($command -ceq 'drafts') { Show-Drafts $first $second; return }
  if ($command -ceq 'suggest') { Send-Suggestion $first $place $tags; return }
  $view = Invoke-Agent 'GET' "/imports/$([Uri]::EscapeDataString($first))" $null $null
  if ($view.Status -ne 200) { Stop-Pinmo 'No such import.' 1 }
  Out (Format-Summary $null $view.Body $origin)
}

$exitCode = 0
try {
  Invoke-Main $Argv
} catch {
  $e = $_.Exception
  while ($null -ne $e -and -not $e.Data.Contains('pinmo') -and $null -ne $e.InnerException) { $e = $e.InnerException }
  if ($null -ne $e -and $e.Data.Contains('pinmo')) {
    Err $e.Message
    $exitCode = [int]$e.Data['pinmo']
  } else {
    Err ($_ | Out-String)
    $exitCode = 1
  }
}
exit $exitCode
```

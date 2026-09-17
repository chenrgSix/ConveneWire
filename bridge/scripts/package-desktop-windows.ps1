[CmdletBinding()]
param(
  [string]$ReleaseTag = $env:RELEASE_TAG,
  [string]$SourceRef = $env:SOURCE_REF,
  [string]$GoArch = $env:GOARCH,
  [string]$OutputDir = $env:OUTPUT_DIR,
  [string]$LocalHubBundle = $env:LOCAL_HUB_BUNDLE
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$bridgeRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$repositoryRoot = Split-Path $bridgeRoot -Parent
. (Join-Path $PSScriptRoot "windows-desktop-icons.ps1")
$productIcon = (Resolve-Path (Join-Path $bridgeRoot "desktop\windows\icon.ico")).Path

function Invoke-WindowsResourceCheck {
  param(
    [ValidateSet("check", "verify")][string]$Mode,
    [string]$ExecutablePath = ""
  )
  $resolvedExecutable = ""
  if ($Mode -eq "verify") {
    # Resolve relative output directories before switching to the tool module.
    $resolvedExecutable = (Resolve-Path -LiteralPath $ExecutablePath).Path
  }
  Push-Location (Join-Path $bridgeRoot "tools\windows-resources")
  try {
    # Match the isolated tool's canonical arithmetic on arm64 and amd64.
    $arguments = @("run", "-gcflags=github.com/srwiley/rasterx=-d=fmahash=qn", ".", "-root", $repositoryRoot, "-mode", $Mode)
    if ($Mode -eq "verify") { $arguments += @("-exe", $resolvedExecutable) }
    & go @arguments
    if ($LASTEXITCODE -ne 0) { throw "Windows product icon resource $Mode failed" }
  }
  finally { Pop-Location }
}
if ([string]::IsNullOrWhiteSpace($OutputDir)) {
  $OutputDir = Join-Path $bridgeRoot "dist"
}
# Resolve against the caller before Go, resource verification or ISCC changes cwd.
$OutputDir = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($OutputDir)
if ([string]::IsNullOrWhiteSpace($ReleaseTag)) {
  throw "RELEASE_TAG is required"
}
if ([string]::IsNullOrWhiteSpace($GoArch)) {
  throw "GOARCH is required"
}
if (-not $ReleaseTag.StartsWith("v")) {
  throw "Release tag must start with v"
}
if ([string]::IsNullOrWhiteSpace($SourceRef)) {
  $SourceRef = "HEAD"
}
$sourceCommit = (& git -C $repositoryRoot rev-parse --verify "$SourceRef^{commit}").Trim()
if ($LASTEXITCODE -ne 0 -or $sourceCommit -notmatch '^[0-9a-f]{40}$') {
  throw "SOURCE_REF must resolve to one exact lowercase commit"
}
$checkoutCommit = (& git -C $repositoryRoot rev-parse --verify "HEAD^{commit}").Trim()
if ($LASTEXITCODE -ne 0 -or $sourceCommit -ne $checkoutCommit) {
  throw "Desktop packaging requires SOURCE_REF to equal the exact checked-out commit"
}
if ([string]::IsNullOrWhiteSpace($LocalHubBundle)) {
  throw "LOCAL_HUB_BUNDLE is required for the Node-first desktop"
}
$LocalHubBundle = (Resolve-Path -LiteralPath $LocalHubBundle).Path
$hubVerifier = Join-Path $repositoryRoot "scripts\local-node\desktop-bundle.mjs"
& node $hubVerifier $LocalHubBundle $sourceCommit $ReleaseTag
if ($LASTEXITCODE -ne 0) { throw "Native Hub verification failed" }

$version = $ReleaseTag.Substring(1)
if ($version -notmatch '^[0-9A-Za-z._-]+$') {
  throw "Release tag must contain only letters, numbers, dots, underscores, and hyphens"
}
if ($version -notmatch '^[0-9]+\.[0-9]+\.[0-9]+(?:[-.][0-9A-Za-z._-]+)?$') {
  throw "Desktop release tag must start with a three-part semantic version"
}
if ($GoArch -ne "amd64") {
  throw "Unsupported Windows desktop architecture: $GoArch"
}
$bundleVersion = ($version -split '-', 2)[0]

$hostOS = (& go env GOHOSTOS).Trim()
$hostArch = (& go env GOHOSTARCH).Trim()
if ($LASTEXITCODE -ne 0) {
  throw "Unable to determine the native Go host"
}
if ("$hostOS/$hostArch" -ne "windows/$GoArch") {
  throw "Desktop package requires a native windows/$GoArch builder; found $hostOS/$hostArch"
}

Invoke-WindowsResourceCheck -Mode check

$package = "convenewire-bridge-desktop_${version}_windows_${GoArch}"
$staging = Join-Path $OutputDir $package
$binary = Join-Path $staging "ConveneWire Bridge.exe"
$cliBinary = Join-Path $staging "convenewire-bridge.exe"
$nodeBinary = Join-Path $staging "convenewire-node.exe"
$archive = Join-Path $OutputDir "${package}.zip"
$installerBase = "${package}_setup"
$installer = Join-Path $OutputDir "${installerBase}.exe"
if ((Test-Path -LiteralPath $staging) -or (Test-Path -LiteralPath $archive) -or
    (Test-Path -LiteralPath $installer)) {
  throw "Desktop package output already exists: $package"
}

New-Item -ItemType Directory -Path $staging -Force | Out-Null
$previousCGO = $env:CGO_ENABLED
$previousGOOS = $env:GOOS
$previousGOARCH = $env:GOARCH
try {
  $env:CGO_ENABLED = "0"
  $env:GOOS = "windows"
  $env:GOARCH = $GoArch
  Push-Location $bridgeRoot
  try {
    $buildArguments = @(
      "build",
      "-tags=desktop,production",
      "-trimpath",
      "-ldflags=-s -w -H=windowsgui -X=main.version=$ReleaseTag -X=main.sourceCommit=$sourceCommit",
      "-o", $binary,
      "./cmd/convenewire-bridge-desktop"
    )
    & go @buildArguments
    if ($LASTEXITCODE -ne 0) {
      throw "Windows Desktop build failed"
    }
    $cliBuildArguments = @(
      "build",
      "-trimpath",
      "-ldflags=-s -w -X=main.version=$ReleaseTag -X=main.sourceCommit=$sourceCommit",
      "-o", $cliBinary,
      "./cmd/convenewire-bridge"
    )
    & go @cliBuildArguments
    if ($LASTEXITCODE -ne 0) {
      throw "Windows CLI helper build failed"
    }
    & go build -trimpath "-ldflags=-s -w -X=main.version=$ReleaseTag -X=main.sourceCommit=$sourceCommit" -o $nodeBinary ./cmd/convenewire-node
    if ($LASTEXITCODE -ne 0) { throw "Windows native Node host build failed" }
  }
  finally {
    Pop-Location
  }
}
finally {
  $env:CGO_ENABLED = $previousCGO
  $env:GOOS = $previousGOOS
  $env:GOARCH = $previousGOARCH
}
Copy-Item -LiteralPath $LocalHubBundle -Destination (Join-Path $staging "hub") -Recurse
& node $hubVerifier (Join-Path $staging "hub") $sourceCommit $ReleaseTag
if ($LASTEXITCODE -ne 0) { throw "Staged native Hub verification failed" }
$nodeVersion = (& $nodeBinary --version).Trim()
if ($LASTEXITCODE -ne 0 -or $nodeVersion -ne $ReleaseTag) { throw "Native Node host version mismatch" }
$nodeBytes = [IO.File]::ReadAllBytes($nodeBinary)
if (-not [Text.Encoding]::ASCII.GetString($nodeBytes).Contains($sourceCommit)) { throw "Native Node host source commit mismatch" }

Copy-Item (Join-Path $bridgeRoot "README.md") (Join-Path $staging "README.md")
Copy-Item (Join-Path $repositoryRoot "LICENSE") (Join-Path $staging "LICENSE")
Copy-Item (Join-Path $repositoryRoot "NOTICE") (Join-Path $staging "NOTICE")
Copy-Item (Join-Path $repositoryRoot "COMMERCIAL-LICENSE.md") (Join-Path $staging "COMMERCIAL-LICENSE.md")
Copy-Item (Join-Path $repositoryRoot "TRADEMARKS.md") (Join-Path $staging "TRADEMARKS.md")

$binaryBytes = [IO.File]::ReadAllBytes($binary)
if ($binaryBytes.Length -lt 64 -or $binaryBytes[0] -ne 0x4d -or $binaryBytes[1] -ne 0x5a) {
  throw "Built desktop Bridge is not a valid Windows PE executable"
}
$peOffset = [BitConverter]::ToInt32($binaryBytes, 0x3c)
if ($peOffset -lt 0 -or $peOffset + 6 -gt $binaryBytes.Length -or
    $binaryBytes[$peOffset] -ne 0x50 -or $binaryBytes[$peOffset + 1] -ne 0x45 -or
    $binaryBytes[$peOffset + 2] -ne 0 -or $binaryBytes[$peOffset + 3] -ne 0) {
  throw "Built desktop Bridge has an invalid PE header"
}
$machine = [BitConverter]::ToUInt16($binaryBytes, $peOffset + 4)
if ($machine -ne 0x8664) {
  throw ("Built desktop Bridge has unexpected PE machine type 0x{0:x4}" -f $machine)
}

$binaryText = [Text.Encoding]::ASCII.GetString($binaryBytes)
if (-not $binaryText.Contains($ReleaseTag)) {
  throw "Built desktop Bridge does not contain the injected version $ReleaseTag"
}
if (-not $binaryText.Contains($sourceCommit)) {
  throw "Built desktop Bridge does not contain the injected source commit $sourceCommit"
}
$cliBytes = [IO.File]::ReadAllBytes($cliBinary)
if ($cliBytes.Length -lt 64 -or $cliBytes[0] -ne 0x4d -or $cliBytes[1] -ne 0x5a) {
  throw "Built CLI helper is not a valid Windows PE executable"
}
$cliPEOffset = [BitConverter]::ToInt32($cliBytes, 0x3c)
if ($cliPEOffset -lt 0 -or $cliPEOffset + 6 -gt $cliBytes.Length -or
    $cliBytes[$cliPEOffset] -ne 0x50 -or $cliBytes[$cliPEOffset + 1] -ne 0x45 -or
    $cliBytes[$cliPEOffset + 2] -ne 0 -or $cliBytes[$cliPEOffset + 3] -ne 0 -or
    [BitConverter]::ToUInt16($cliBytes, $cliPEOffset + 4) -ne 0x8664) {
  throw "Built CLI helper has an invalid or non-amd64 PE header"
}
$cliText = [Text.Encoding]::ASCII.GetString($cliBytes)
if (-not $cliText.Contains($ReleaseTag) -or -not $cliText.Contains($sourceCommit)) {
  throw "Built CLI helper omits the injected version or source commit"
}
$cliVersion = (& $cliBinary version).Trim()
if ($LASTEXITCODE -ne 0 -or $cliVersion -ne $ReleaseTag) {
  throw "Built CLI helper reports '$cliVersion', expected $ReleaseTag"
}

Invoke-WindowsResourceCheck -Mode verify -ExecutablePath $binary
Assert-ConveneWireNativeIcon -ExecutablePath $binary -IconPath $productIcon

. (Join-Path $PSScriptRoot "windows-desktop-archive.ps1")
New-ConveneWireDesktopArchive -StagingDirectory $staging -ArchivePath $archive
if (-not (Test-Path -LiteralPath $archive) -or (Get-Item -LiteralPath $archive).Length -eq 0) {
  throw "Windows Desktop archive was not created"
}

Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [IO.Compression.ZipFile]::OpenRead($archive)
try {
  $seen = [Collections.Generic.HashSet[string]]::new(
    [StringComparer]::Ordinal
  )
  foreach ($entry in $zip.Entries) {
    $member = $entry.FullName
    $pathWithoutTrailingSlash = $member.TrimEnd('/')
    $segments = @($pathWithoutTrailingSlash.Split('/'))
    if ([string]::IsNullOrWhiteSpace($member) -or
        $member.Contains("\") -or $member.Contains([char]0) -or
        $member.StartsWith("/") -or $member -match '^[A-Za-z]:' -or
        [string]::IsNullOrWhiteSpace($pathWithoutTrailingSlash) -or
        @($segments | Where-Object {
          [string]::IsNullOrEmpty($_) -or $_ -eq '.' -or $_ -eq '..'
        }).Count -gt 0 -or -not $seen.Add($member)) {
      throw "Windows Desktop archive contains an unsafe path: $member"
    }
    $unixType = ($entry.ExternalAttributes -shr 16) -band 0xF000
    if ($unixType -eq 0xA000) {
      throw "Windows Desktop archive contains a symbolic-link path: $member"
    }
  }
  $members = @($zip.Entries | ForEach-Object { $_.FullName })
  $requiredMembers = @(
    "$package/ConveneWire Bridge.exe",
    "$package/convenewire-bridge.exe",
    "$package/convenewire-node.exe",
    "$package/hub/hub-manifest.json",
    "$package/hub/bin/node.exe",
    "$package/hub/NODE-LICENSE",
    "$package/README.md",
    "$package/LICENSE",
    "$package/NOTICE",
    "$package/COMMERCIAL-LICENSE.md",
    "$package/TRADEMARKS.md"
  )
  foreach ($requiredMember in $requiredMembers) {
    if ($members -notcontains $requiredMember) {
      throw "Windows Desktop archive is missing $requiredMember"
    }
  }
  $hubPrefix = "$package/hub/"
  $hubEntries = [Collections.Generic.Dictionary[string, object]]::new([StringComparer]::Ordinal)
  foreach ($entry in $zip.Entries) {
    if ($entry.FullName.StartsWith($hubPrefix, [StringComparison]::Ordinal) -and -not $entry.FullName.EndsWith('/')) {
      $hubEntries.Add($entry.FullName.Substring($hubPrefix.Length), $entry)
    }
  }
  $hubManifestPath = Join-Path $staging "hub\hub-manifest.json"
  $hubManifest = Get-Content -LiteralPath $hubManifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
  $hubFiles = @($hubManifest.files) + @([PSCustomObject]@{
    path = "hub-manifest.json";
    size = (Get-Item -LiteralPath $hubManifestPath).Length;
    sha256 = (Get-FileHash -LiteralPath $hubManifestPath -Algorithm SHA256).Hash
  })
  if ($hubEntries.Count -ne $hubFiles.Count) { throw "Archived Hub inventory differs from its verified manifest" }
  foreach ($file in $hubFiles) {
    if (-not $hubEntries.ContainsKey($file.path) -or $hubEntries[$file.path].Length -ne $file.size) { throw "Archived Hub file is missing or truncated: $($file.path)" }
    $stream = $hubEntries[$file.path].Open()
    $sha = [Security.Cryptography.SHA256]::Create()
    try { $actual = [BitConverter]::ToString($sha.ComputeHash($stream)).Replace("-", "") }
    finally { $sha.Dispose(); $stream.Dispose() }
    if ($actual -ne $file.sha256) { throw "Archived Hub file digest mismatch: $($file.path)" }
  }
  foreach ($executable in @(
      @{ Member = "$package/ConveneWire Bridge.exe"; Path = $binary },
      @{ Member = "$package/convenewire-bridge.exe"; Path = $cliBinary },
      @{ Member = "$package/convenewire-node.exe"; Path = $nodeBinary }
    )) {
    $binaryEntries = @($zip.Entries | Where-Object {
      $_.FullName.Replace("\", "/") -eq $executable.Member
    })
    if ($binaryEntries.Count -ne 1) {
      throw "Windows Desktop archive must contain exactly one $($executable.Member)"
    }
    $entryStream = $binaryEntries[0].Open()
    $sha256 = [Security.Cryptography.SHA256]::Create()
    try {
      $entryDigest = [BitConverter]::ToString($sha256.ComputeHash($entryStream)).Replace("-", "")
    }
    finally {
      $sha256.Dispose()
      $entryStream.Dispose()
    }
    $stagedDigest = (Get-FileHash -LiteralPath $executable.Path -Algorithm SHA256).Hash
    if ($entryDigest -ne $stagedDigest) {
      throw "Windows Desktop archive executable differs from the staged payload: $($executable.Member)"
    }
  }
}
finally {
  $zip.Dispose()
}

$compilerCandidates = @(
  $env:ISCC_PATH,
  (Join-Path ${env:ProgramFiles(x86)} "Inno Setup 6\ISCC.exe"),
  (Join-Path $env:ProgramFiles "Inno Setup 6\ISCC.exe"),
  (Join-Path ${env:ProgramFiles(x86)} "Inno Setup 7\ISCC.exe"),
  (Join-Path $env:ProgramFiles "Inno Setup 7\ISCC.exe")
)
$compiler = $compilerCandidates |
  Where-Object { -not [string]::IsNullOrWhiteSpace($_) -and (Test-Path -LiteralPath $_) } |
  Select-Object -First 1
if ([string]::IsNullOrWhiteSpace($compiler)) {
  throw "Inno Setup Compiler was not found; set ISCC_PATH or install Inno Setup 6 or 7"
}

$installerScript = Join-Path $bridgeRoot "desktop\windows\installer.iss"
$compilerArguments = @(
  "/DAppVersion=$version",
  "/DBundleVersion=$bundleVersion",
  "/DSourceDir=$staging",
  "/DOutputDir=$OutputDir",
  "/DOutputBaseFilename=$installerBase",
  "/DIconFile=$productIcon",
  $installerScript
)
& $compiler @compilerArguments
if ($LASTEXITCODE -ne 0) {
  throw "Windows Desktop installer build failed"
}
if (-not (Test-Path -LiteralPath $installer) -or (Get-Item -LiteralPath $installer).Length -eq 0) {
  throw "Windows Desktop installer was not created"
}
$installerInfo = [Diagnostics.FileVersionInfo]::GetVersionInfo($installer)
$installerFileVersion = @(
  $installerInfo.FileMajorPart,
  $installerInfo.FileMinorPart,
  $installerInfo.FileBuildPart
) -join "."
$installerProductName = ([string]$installerInfo.ProductName).Trim()
if ($installerProductName -ne "ConveneWire Bridge" -or
    $installerFileVersion -ne $bundleVersion) {
  throw ("Windows Desktop installer has unexpected product metadata: " +
    "ProductName='$installerProductName', FileVersion='$installerFileVersion'")
}

Assert-ConveneWireNativeIcon -ExecutablePath $installer -IconPath $productIcon

Write-Output $archive
Write-Output $installer

function New-ConveneWireDesktopArchive {
  param(
    [Parameter(Mandatory = $true)][string]$StagingDirectory,
    [Parameter(Mandatory = $true)][string]$ArchivePath
  )

  $staging = Get-Item -LiteralPath $StagingDirectory -Force -ErrorAction Stop
  if (-not $staging.PSIsContainer -or
      ($staging.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
    throw "Desktop archive requires a regular staging directory"
  }
  if (Test-Path -LiteralPath $ArchivePath) { throw "Desktop archive already exists" }
  $prefix = $staging.FullName.TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar
  $files = [Collections.Generic.List[object]]::new()
  $directories = [Collections.Generic.Stack[object]]::new()
  $directories.Push($staging)
  while ($directories.Count -gt 0) {
    $directory = $directories.Pop()
    foreach ($entry in Get-ChildItem -LiteralPath $directory.FullName -Force -ErrorAction Stop) {
      if (($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw "Desktop archive cannot contain a linked path: $($entry.FullName)"
      }
      if ($entry.PSIsContainer) { $directories.Push($entry) }
      else { $files.Add($entry) }
    }
  }

  Add-Type -AssemblyName System.IO.Compression
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $zip = [IO.Compression.ZipFile]::Open(
    $ArchivePath, [IO.Compression.ZipArchiveMode]::Create, [Text.Encoding]::UTF8
  )
  try {
    foreach ($file in $files) {
      # Windows PowerShell Compress-Archive writes backslashes and omits hidden
      # files. ZIP member names and the verified Hub inventory require both.
      $member = $staging.Name + '/' + $file.FullName.Substring($prefix.Length).Replace('\', '/')
      [IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
        $zip, $file.FullName, $member, [IO.Compression.CompressionLevel]::Optimal
      ) | Out-Null
    }
  }
  finally { $zip.Dispose() }
}

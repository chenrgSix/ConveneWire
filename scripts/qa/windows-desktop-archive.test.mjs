import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

const exec = promisify(execFile);
const writer = fileURLToPath(new URL("../../bridge/scripts/windows-desktop-archive.ps1", import.meta.url));
const quote = value => `'${value.replaceAll("'", "''")}'`;

test("native Windows ZIP preserves portable paths, Unicode and hidden Hub files", {
  skip: process.platform !== "win32"
}, async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), "convenewire-windows-zip-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const staging = path.join(root, "desktop-package");
  const hidden = path.join(staging, "hub", ".runtime-data");
  await mkdir(path.join(staging, "hub", "snow ☃"), { recursive: true });
  await writeFile(hidden, "hidden payload");
  await writeFile(path.join(staging, "hub", "snow ☃", "index.html"), "unicode payload");
  const archive = path.join(root, "desktop.zip");
  const { stdout } = await exec("powershell.exe", ["-NoProfile", "-Command", `
$ErrorActionPreference = 'Stop'
. ${quote(writer)}
(Get-Item -LiteralPath ${quote(hidden)}).Attributes = [IO.FileAttributes]::Hidden
New-ConveneWireDesktopArchive -StagingDirectory ${quote(staging)} -ArchivePath ${quote(archive)}
$zip = [IO.Compression.ZipFile]::OpenRead(${quote(archive)})
try {
  if ($zip.Entries.Count -ne 2) { throw 'Hidden or Unicode member missing' }
  foreach ($entry in $zip.Entries) {
    if ($entry.FullName.Contains('\\')) { throw 'Backslash member' }
    $expected = switch ($entry.FullName) {
      'desktop-package/hub/.runtime-data' { 'hidden payload' }
      'desktop-package/hub/snow ☃/index.html' { 'unicode payload' }
      default { throw 'Unexpected member' }
    }
    $reader = [IO.StreamReader]::new($entry.Open())
    try { if ($reader.ReadToEnd() -ne $expected) { throw 'Changed payload' } }
    finally { $reader.Dispose() }
  }
} finally { $zip.Dispose() }
$digest = (Get-FileHash -LiteralPath ${quote(archive)}).Hash
$rejected = $false
try { New-ConveneWireDesktopArchive -StagingDirectory ${quote(staging)} -ArchivePath ${quote(archive)} }
catch { $rejected = $true }
if (-not $rejected -or (Get-FileHash -LiteralPath ${quote(archive)}).Hash -ne $digest) { throw 'Existing archive was replaced' }
$outside = New-Item -ItemType Directory -Path ${quote(path.join(root, "outside"))}
Set-Content -LiteralPath (Join-Path $outside.FullName 'private.txt') -Value 'outside payload'
New-Item -ItemType Junction -Path ${quote(path.join(staging, "linked"))} -Target $outside.FullName | Out-Null
$rejected = $false
try { New-ConveneWireDesktopArchive -StagingDirectory ${quote(staging)} -ArchivePath ${quote(path.join(root, "linked.zip"))} }
catch { $rejected = $true }
if (-not $rejected -or (Test-Path -LiteralPath ${quote(path.join(root, "linked.zip"))})) { throw 'Linked content was archived' }
Write-Output 'WINDOWS_ZIP_PASSED'
`]);
  assert.match(stdout, /WINDOWS_ZIP_PASSED/u);
});

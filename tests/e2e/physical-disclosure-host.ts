import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { spawnTestProcess } from "../../scripts/test/child-process.mjs";

const execute = promisify(execFile);
export const ps = (value: string): string => `'${value.replaceAll("'", "''")}'`;
type Resources = Parameters<typeof spawnTestProcess>[0];
export interface PhysicalHostConfig {
  host: string;
  identityFile: string;
  knownHostsFile: string;
  workspace: string;
  node: string;
  windowsBinary: string;
  reportFile: string;
}

// Explicit physical QA only. No default address, password, user config, host-key
// enrollment, global installation or provider call belongs in this adapter.
export class PhysicalWindowsHost {
  readonly options: string[];
  constructor(readonly config: PhysicalHostConfig) {
    assert.match(config.host, /^[A-Za-z0-9_.-]+@[A-Za-z0-9_.-]+$/u);
    assert.match(config.workspace, /^[A-Za-z]:\\/u);
    for (const name of ["identityFile", "knownHostsFile", "windowsBinary", "reportFile"] as const) {
      assert.ok(path.isAbsolute(config[name]), `${name} must be absolute`);
    }
    this.options = ["-F", "/dev/null", "-i", config.identityFile,
      "-o", "IdentitiesOnly=yes", "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes",
      "-o", `UserKnownHostsFile=${config.knownHostsFile}`, "-o", "GlobalKnownHostsFile=/dev/null",
      "-o", "HostKeyAlgorithms=ssh-ed25519", "-o", "ConnectTimeout=10",
      "-o", "ForwardAgent=no", "-o", "ForwardX11=no"];
  }

  command(script: string): string {
    const prefix = "$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding; ";
    return `powershell.exe -NoLogo -NoProfile -NonInteractive -EncodedCommand ${Buffer.from(prefix + script, "utf16le").toString("base64")}`;
  }

  async run(script: string): Promise<string> {
    try {
      return (await execute("ssh", [...this.options, this.config.host, this.command(script)], {
        timeout: 45000, maxBuffer: 2 << 20
      })).stdout.trim();
    } catch (error) {
      // execFile errors include command text, which may contain fixture metadata.
      const e = error as { code?: number; stdout?: string };
      throw new Error(`Physical Windows command failed (${e.code}); output bytes=${Buffer.byteLength(e.stdout ?? "")}`);
    }
  }

  async put(local: string, remote: string): Promise<void> {
    assert.match(remote, /^[A-Za-z]:\\[A-Za-z0-9_.\\-]+$/u);
    try {
      await execute("scp", [...this.options, local, `${this.config.host}:${remote.replaceAll("\\", "/")}`], { timeout: 45000 });
    } catch {
      throw new Error("Physical fixture copy failed");
    }
  }

  async putJson(local: string, remote: string, value: unknown): Promise<void> {
    await writeFile(local, JSON.stringify(value), { mode: 0o600 });
    await this.put(local, remote);
  }

  async readJson(remote: string): Promise<any> {
    return JSON.parse(await this.run(`Get-Content -Raw -LiteralPath ${ps(remote)}`));
  }

  async createRoot(root: string, marker: string): Promise<void> {
    assert.ok(root.startsWith(`${this.config.workspace}\\.cache\\qa085-`));
    await this.run(`if (Test-Path -LiteralPath ${ps(root)}) { throw 'Fixture root exists' }
      New-Item -ItemType Directory -Path ${ps(root)} | Out-Null
      $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
      $acl=New-Object Security.AccessControl.DirectorySecurity
      $acl.SetSecurityDescriptorSddlForm('O:'+$sid+'D:P(A;OICI;FA;;;'+$sid+')(A;OICI;FA;;;SY)')
      Set-Acl -LiteralPath ${ps(root)} -AclObject $acl
      if (!(Get-Acl -LiteralPath ${ps(root)}).AreAccessRulesProtected) { throw 'Fixture root ACL unavailable' }
      Set-Content -LiteralPath ${ps(`${root}\\owner-marker.txt`)} -Value ${ps(marker)} -Encoding ascii`);
  }

  async removeRoot(root: string, marker: string): Promise<void> {
    await this.run(`$r=Get-Item -LiteralPath ${ps(root)}
      if (($r.Attributes -band [IO.FileAttributes]::ReparsePoint) -or (Get-Content -Raw -LiteralPath ${ps(`${root}\\owner-marker.txt`)}).Trim() -ne ${ps(marker)}) { throw 'Fixture owner changed' }
      Remove-Item -LiteralPath ${ps(root)} -Recurse -Force
      if (Test-Path -LiteralPath ${ps(root)}) { throw 'Fixture cleanup incomplete' }`);
  }

  async bridge(resources: Resources, root: string, configFile: string) {
    const binary = `${root}\\bridge.exe`, pidFile = `${root}\\bridge.pid`;
    const script = `$p=Start-Process -FilePath ${ps(binary)} -ArgumentList @('run','--config',${ps(configFile)}) -NoNewWindow -PassThru
      Set-Content -LiteralPath ${ps(pidFile)} -Value $p.Id -Encoding ascii
      $p.WaitForExit(); exit $p.ExitCode`;
    const child = spawnTestProcess(resources, "ssh", [...this.options, this.config.host, this.command(script)], { stdio: ["ignore", "pipe", "pipe"] });
    // The remote PID is checked against the exact test-owned executable before
    // stopping. Never kill another installed Bridge or an unrelated process.
    let stopped = false;
    const stop = async () => {
      if (stopped) return;
      await this.run(`if (Test-Path -LiteralPath ${ps(pidFile)}) {
        $cwPid=[int](Get-Content -Raw -LiteralPath ${ps(pidFile)})
        $p=Get-Process -Id $cwPid -ErrorAction SilentlyContinue
        if ($p) { if ($p.Path -ne ${ps(binary)}) { throw 'Process identity changed' }; Stop-Process -Id $cwPid -Force }
      }`);
      await child.stop();
      stopped = true;
    };
    resources.defer(stop);
    return { child, stop };
  }
}

export async function physicalConfig(): Promise<PhysicalHostConfig> {
  assert.equal(process.env.CONVENE_WIRE_PHYSICAL_DISCLOSURE, "1", "Physical execution requires explicit opt-in");
  assert.ok(process.env.CONVENE_WIRE_QA085_CONFIG, "A locally approved remote configuration is required");
  return JSON.parse(await readFile(process.env.CONVENE_WIRE_QA085_CONFIG, "utf8"));
}

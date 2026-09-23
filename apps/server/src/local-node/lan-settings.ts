import { lstat } from "node:fs/promises";
import path from "node:path";
import { parsePeerJson } from "@convene-wire/contracts/peer-json";
import { exactObject, privateRead } from "./relay-private.js";

/** Network settings share one authority origin once LAN has been enabled. */
export async function assertManagedLANOrigin(root: string, origin: string): Promise<void> {
  const directory = path.join(root, "managed-lan");
  try { await lstat(directory); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  const raw = await privateRead(directory, "settings.json", 4096);
  if (!raw) return;
  const value = exactObject(parsePeerJson(raw), ["origin", "enabled", "port"]);
  if (value.origin !== origin) throw new Error("此设备已使用局域网地址建立连接，不能更换节点地址。已有连接仍可继续使用。");
}

export async function assertNoPendingNetworkChange(root: string): Promise<void> {
  for (const file of ["peer-ingress.pending.json", "relay.pending.json"]) {
    if (await privateRead(root, file)) throw new Error("有待生效的高级网络设置，请先重启应用或取消该设置，再开启局域网。");
  }
}

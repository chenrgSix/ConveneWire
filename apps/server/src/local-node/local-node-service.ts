import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type Database from "better-sqlite3";
import type { FastifyRequest } from "fastify";
import type { LocalNodeBinding, LocalNodeLaunch } from "@convene-wire/contracts/local-node";
import schema from "@convene-wire/contracts/local-node-schema" with { type: "json" };
import { Ajv2020 } from "ajv/dist/2020.js";
import type { CoreRepository } from "../data/core-repository.js";
import { createOpaqueId } from "../domain/identifiers.js";
import { AuthService, AuthorizationError, type WebPrincipal } from "../security/auth-service.js";

const validator = new Ajv2020({ strict: true }).addSchema(schema);
const validateLaunch = validator.getSchema(`${schema.$id}#/$defs/LocalNodeLaunch`)!;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const forbidden = () => new AuthorizationError("FORBIDDEN", "Local Node authority denied");

export function parseLocalNodeLaunch(value: unknown): LocalNodeLaunch {
  if (!validateLaunch(value)) throw new Error("Invalid Local Node launch configuration");
  return value as LocalNodeLaunch;
}

interface InstallationRow { node_id: string; owner_user_id: string; origin: string; secret_hash: string }
interface BindingRow { team_id: string; device_id: string; credential_envelope: string }

export class LocalNodeService {
  public readonly origin: string;
  private readonly tickets = new Map<string, number>();
  private readonly key: Buffer;

  public constructor(
    private readonly database: Database.Database,
    private readonly core: CoreRepository,
    private readonly auth: AuthService,
    public readonly launch: LocalNodeLaunch,
    now: string
  ) {
    parseLocalNodeLaunch(launch);
    this.origin = `http://127.0.0.1:${launch.identity.port}`;
    this.key = createHash("sha256").update(launch.identity.secret).digest();
    database.transaction(() => {
      const existing = database.prepare("SELECT * FROM local_node_installation WHERE singleton = 1").get() as InstallationRow | undefined;
      if (existing) {
        if (existing.node_id !== launch.identity.nodeId || existing.owner_user_id !== launch.identity.ownerUserId ||
            existing.origin !== this.origin || existing.secret_hash !== hash(launch.identity.secret) || !core.getUser(existing.owner_user_id)) {
          throw new Error("Local Node identity does not match its database");
        }
      } else {
        const count = database.prepare("SELECT count(*) AS count FROM web_users").get() as { count: number };
        if (count.count !== 0) throw new Error("Local Node cannot adopt an existing Central database");
        core.ensureUser({ userId: launch.identity.ownerUserId, displayName: "Local Owner", createdAt: now });
        database.prepare("INSERT INTO local_node_installation VALUES (1, ?, ?, ?, ?, ?)")
          .run(launch.identity.nodeId, launch.identity.ownerUserId, this.origin, hash(launch.identity.secret), now);
      }
    }).immediate();
  }

  public assertRequest(request: FastifyRequest): void {
    if (request.headers.host !== new URL(this.origin).host ||
        (request.headers.origin !== undefined && request.headers.origin !== this.origin) ||
        request.headers["sec-fetch-site"] === "cross-site") throw forbidden();
  }

  public requireControl(request: FastifyRequest): void {
    // Browsers cannot exercise the supervisor channel, even with Owner access.
    if (request.headers.origin !== undefined || request.headers["sec-fetch-mode"] !== undefined) throw forbidden();
    const value = request.headers["x-convenewire-node-control"];
    if (typeof value !== "string" || !timingSafeEqual(Buffer.from(hash(value)), Buffer.from(hash(this.launch.controlToken)))) throw forbidden();
  }

  public requireOwner(actor: WebPrincipal): void {
    this.auth.requireFullWebSession(actor);
    if (actor.userId !== this.launch.identity.ownerUserId) throw forbidden();
  }

  public entry(now: string): { url: string } {
    const instant = Date.parse(now);
    for (const [key, expiry] of this.tickets) if (expiry <= instant) this.tickets.delete(key);
    // A desktop may reopen its window repeatedly; bound abandoned tickets.
    if (this.tickets.size >= 16) this.tickets.delete(this.tickets.keys().next().value!);
    const ticket = randomBytes(32).toString("base64url");
    this.tickets.set(hash(ticket), instant + 120_000);
    return { url: `${this.origin}/#/local-node/${ticket}` };
  }

  public claim(ticket: unknown, now: string) {
    if (typeof ticket !== "string" || !/^[A-Za-z0-9_-]{43}$/u.test(ticket)) throw forbidden();
    const key = hash(ticket);
    const expiresAt = this.tickets.get(key);
    if (!expiresAt || expiresAt <= Date.parse(now)) throw forbidden();
    this.tickets.delete(key);
    const session = this.auth.issueWebSession(this.launch.identity.ownerUserId, now, new Date(Date.parse(now) + 24 * 60 * 60 * 1000).toISOString());
    return { user: this.core.getUser(this.launch.identity.ownerUserId)!, session: { token: session.secret, expiresAt: session.expiresAt } };
  }

  public status() {
    const row = this.database.prepare("SELECT team_id, device_id FROM local_node_binding WHERE singleton = 1").get() as BindingRow | undefined;
    return { nodeId: this.launch.identity.nodeId, teamId: row?.team_id ?? null, deviceId: row?.device_id ?? null };
  }

  public bind(actor: WebPrincipal, teamId: string, now: string) {
    this.requireOwner(actor);
    const member = this.auth.requireTeamMember(actor, teamId);
    if (member.role !== "owner") throw forbidden();
    return this.database.transaction(() => {
      const existing = this.status();
      if (existing.teamId) {
        if (existing.teamId !== teamId) throw new Error("Local Runtime is already bound to another Team");
        this.binding(now); // Repeated selection must not resurrect a revoked Device.
        return existing;
      }
      const deviceId = createOpaqueId("device");
      this.core.createDevice({ deviceId, teamId, ownerMemberId: member.memberId, name: "Local Node", status: "active", createdAt: now, revokedAt: null });
      const credential = this.auth.issueDeviceCredential(deviceId, now);
      const binding: LocalNodeBinding = { serverUrl: this.origin, deviceId, teamId, ownerMemberId: member.memberId, token: credential.secret };
      const nonce = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", this.key, nonce);
      cipher.setAAD(Buffer.from(`${this.launch.identity.nodeId}:${deviceId}`));
      const ciphertext = Buffer.concat([cipher.update(JSON.stringify(binding), "utf8"), cipher.final()]);
      const envelope = Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]).toString("base64");
      this.database.prepare("INSERT INTO local_node_binding VALUES (1, ?, ?, ?, ?)").run(teamId, deviceId, envelope, now);
      return this.status();
    }).immediate();
  }

  public binding(now: string): LocalNodeBinding | null {
    const row = this.database.prepare("SELECT * FROM local_node_binding WHERE singleton = 1").get() as BindingRow | undefined;
    if (!row) return null;
    const envelope = Buffer.from(row.credential_envelope, "base64");
    const decipher = createDecipheriv("aes-256-gcm", this.key, envelope.subarray(0, 12));
    decipher.setAuthTag(envelope.subarray(12, 28));
    decipher.setAAD(Buffer.from(`${this.launch.identity.nodeId}:${row.device_id}`));
    const binding = JSON.parse(Buffer.concat([decipher.update(envelope.subarray(28)), decipher.final()]).toString("utf8")) as LocalNodeBinding;
    const actor = this.auth.authenticateDevice(binding.token, now);
    if (actor.deviceId !== row.device_id || actor.teamId !== row.team_id || binding.serverUrl !== this.origin) throw forbidden();
    return binding;
  }
}

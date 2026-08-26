import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { isIPv4 } from "node:net";

const integer = (name: string, fallback: number, min: number, max: number) => { const value = Number(process.env[name] ?? fallback); if (!Number.isInteger(value) || value < min || value > max) throw new Error(`Configuracao invalida: ${name}`); return value; };
const dataDir = resolve(process.env.VAULT_DATA_DIR || join(process.cwd(), "data"));
const host = process.env.VAULT_BIND_HOST || "0.0.0.0";
export function isPrivateIpv4(value: string) { if (!isIPv4(value)) return false; const [first, second] = value.split(".").map(Number); return first === 10 || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168); }
if (host !== "0.0.0.0" && host !== "127.0.0.1" && !isPrivateIpv4(host)) throw new Error("VAULT_BIND_HOST deve ser 0.0.0.0, loopback ou IPv4 privado.");
const publicUrl = process.env.VAULT_PUBLIC_URL || "http://192.168.0.25:7443";
const parsedPublicUrl = new URL(publicUrl);
if (parsedPublicUrl.protocol !== "http:") throw new Error("VAULT_PUBLIC_URL deve usar HTTP na implantacao local.");
export const config = {
  host, port: integer("VAULT_PORT", 7443, 1024, 65535), dataDir,
  databasePath: join(dataDir, "vault.db"), attachmentDir: join(dataDir, "attachments"), quarantineDir: join(dataDir, "quarantine"), backupDir: resolve(process.env.VAULT_BACKUP_DIR || join(dataDir, "backups")),
  masterKeyPath: join(dataDir, "master-key.dpapi"), agentCredentialPath: join(dataDir, "sync-agent.dpapi"),
  publicUrl: parsedPublicUrl.origin,
  allowedOrigins: new Set(["http://127.0.0.1:7443", "http://localhost:7443", "http://192.168.0.25:7443"]),
  sessionIdleMs: integer("VAULT_SESSION_IDLE_MINUTES", 10, 1, 60) * 60_000, sessionMaxMs: integer("VAULT_SESSION_MAX_HOURS", 8, 1, 24) * 3_600_000,
  maxFileBytes: integer("VAULT_MAX_FILE_MB", 25, 1, 100) * 1024 * 1024, trashDays: integer("VAULT_TRASH_DAYS", 30, 1, 365),
};
[config.dataDir,config.attachmentDir,config.quarantineDir,config.backupDir].forEach((dir) => mkdirSync(dir,{recursive:true,mode:0o700}));

import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

const integer = (name: string, fallback: number, min: number, max: number) => { const value = Number(process.env[name] ?? fallback); if (!Number.isInteger(value) || value < min || value > max) throw new Error(`Configuracao invalida: ${name}`); return value; };
const dataDir = resolve(process.env.VAULT_DATA_DIR || join(process.cwd(), "data"));
export const config = {
  host: process.env.VAULT_BIND_HOST || "127.0.0.1", port: integer("VAULT_PORT", 7443, 1024, 65535), dataDir,
  databasePath: join(dataDir, "vault.db"), attachmentDir: join(dataDir, "attachments"), quarantineDir: join(dataDir, "quarantine"), backupDir: resolve(process.env.VAULT_BACKUP_DIR || join(dataDir, "backups")),
  masterKeyPath: join(dataDir, "master-key.dpapi"), agentCredentialPath: join(dataDir, "sync-agent.dpapi"),
  certPath: resolve(process.env.VAULT_CERT_PATH || join(dataDir, "certificates", "vault.crt")), keyPath: resolve(process.env.VAULT_KEY_PATH || join(dataDir, "certificates", "vault.key")),
  publicOrigin: process.env.VAULT_PUBLIC_ORIGIN || "https://127.0.0.1:7443", mainAppOrigin: process.env.VAULT_MAIN_APP_ORIGIN || "",
  sessionIdleMs: integer("VAULT_SESSION_IDLE_MINUTES", 10, 1, 60) * 60_000, sessionMaxMs: integer("VAULT_SESSION_MAX_HOURS", 8, 1, 24) * 3_600_000,
  maxFileBytes: integer("VAULT_MAX_FILE_MB", 25, 1, 100) * 1024 * 1024, trashDays: integer("VAULT_TRASH_DAYS", 30, 1, 365),
};
[config.dataDir,config.attachmentDir,config.quarantineDir,config.backupDir].forEach((dir) => mkdirSync(dir,{recursive:true,mode:0o700}));

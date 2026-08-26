import argon2 from "argon2";
import { randomBytes, randomUUID } from "node:crypto";
import { audit } from "./audit.js";
import { config } from "./config.js";
import { one, run } from "./database.js";
import { sha256 } from "./crypto.js";

export type VaultRole = "vault_admin" | "vault_operator" | "vault_auditor";
type User = { id: string; username: string; password_hash: string; role: VaultRole; active: number; failed_attempts: number; locked_until: string | null };
const hashOptions = { type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1 } as const;
const normalized = (username: string) => username.trim().toLowerCase();
const assertPassword = (password: string) => { if (password.length < 15) throw new Error("Use uma senha com pelo menos 15 caracteres."); };

export async function createFirstAdmin(username: string, password: string) {
  if (one<{ count: number }>("select count(*) count from vault_users")?.count) throw new Error("O primeiro administrador ja foi criado.");
  assertPassword(password);
  const id = randomUUID(), now = new Date().toISOString();
  run("insert into vault_users(id,username,password_hash,role,created_at,updated_at) values(?,?,?,?,?,?)", id, normalized(username), await argon2.hash(password, hashOptions), "vault_admin", now, now);
  audit({ userId: id, action: "first_admin_created", result: "success", objectType: "vault_user", objectId: id });
  return { userId: id };
}

export async function createVaultUser(username: string, password: string, role: VaultRole) {
  if (!["vault_admin", "vault_operator", "vault_auditor"].includes(role)) throw new Error("ROLE_INVALID");
  assertPassword(password);
  if (!one<{ count: number }>("select count(*) count from vault_users")?.count) throw new Error("Crie primeiro o administrador inicial.");
  const id = randomUUID(), now = new Date().toISOString();
  run("insert into vault_users(id,username,password_hash,role,created_at,updated_at) values(?,?,?,?,?,?)", id, normalized(username), await argon2.hash(password, hashOptions), role, now, now);
  audit({ action: "vault_user_created_by_local_operator", result: "success", objectType: "vault_user", objectId: id, metadata: { role } });
  return { userId: id };
}

export async function login(username: string, password: string, address: string) {
  const user = one<User>("select * from vault_users where username=?", normalized(username));
  const now = Date.now();
  if (!user || !user.active) { audit({ action: "login_denied", result: "denied", localAddress: address }); throw new Error("Credenciais invalidas."); }
  if (user.locked_until && Date.parse(user.locked_until) > now) { audit({ userId: user.id, action: "login_locked", result: "denied", localAddress: address }); throw new Error("Acesso temporariamente bloqueado."); }
  const passwordOk = await argon2.verify(user.password_hash, password).catch(() => false);
  if (!passwordOk) {
    const failures = user.failed_attempts + 1;
    const delay = failures >= 5 ? Math.min(60, 2 ** Math.min(failures - 5, 6)) : 0;
    run("update vault_users set failed_attempts=?,locked_until=?,updated_at=? where id=?", failures, delay ? new Date(now + delay * 60_000).toISOString() : null, new Date().toISOString(), user.id);
    audit({ userId: user.id, action: failures >= 5 ? "login_temporarily_locked" : "login_denied", result: "denied", localAddress: address, metadata: { failedAttempts: failures } });
    throw new Error("Credenciais invalidas.");
  }
  run("update vault_users set failed_attempts=0,locked_until=null,updated_at=? where id=?", new Date().toISOString(), user.id);
  const token = randomBytes(32).toString("base64url"), csrf = randomBytes(24).toString("base64url"), id = randomUUID(), created = new Date(), expires = new Date(created.getTime() + config.sessionMaxMs);
  run("insert into vault_sessions(id,user_id,token_hash,csrf_hash,created_at,last_activity_at,expires_at,local_address) values(?,?,?,?,?,?,?,?)", id, user.id, sha256(token), sha256(csrf), created.toISOString(), created.toISOString(), expires.toISOString(), address);
  audit({ userId: user.id, action: "login_success", result: "success", localAddress: address });
  return { token, csrf, user: { id: user.id, username: user.username, role: user.role }, expiresAt: expires.toISOString() };
}

export function unlockVaultUser(username: string) { const user = one<{ id: string }>("select id from vault_users where username=?", normalized(username)); if (!user) throw new Error("USER_NOT_FOUND"); run("update vault_users set failed_attempts=0,locked_until=null,updated_at=? where id=?", new Date().toISOString(), user.id); audit({ action: "vault_user_unlocked_locally", result: "success", objectType: "vault_user", objectId: user.id }); }
export function setVaultUserActive(username: string, active: boolean) { const user = one<{ id: string }>("select id from vault_users where username=?", normalized(username)); if (!user) throw new Error("USER_NOT_FOUND"); const now = new Date().toISOString(); run("update vault_users set active=?,updated_at=? where id=?", active ? 1 : 0, now, user.id); if (!active) run("update vault_sessions set revoked_at=? where user_id=? and revoked_at is null", now, user.id); audit({ action: active ? "vault_user_enabled_locally" : "vault_user_disabled_locally", result: "success", objectType: "vault_user", objectId: user.id }); }
export function revokeAllSessions(reason = "administrative_security_action") { const now = new Date().toISOString(); run("update vault_sessions set revoked_at=? where revoked_at is null", now); audit({ action: "all_sessions_revoked", result: "success", objectType: "vault_session", objectId: "all", metadata: { reason } }); }
export function authenticate(token: string | undefined, csrf: string | undefined, mutating: boolean) { if (!token) return null; const session = one<{ id:string;user_id:string;csrf_hash:string;last_activity_at:string;expires_at:string;revoked_at:string|null;username:string;role:VaultRole;active:number }>("select s.*,u.username,u.role,u.active from vault_sessions s join vault_users u on u.id=s.user_id where s.token_hash=?", sha256(token)); const now=Date.now(); if(!session||session.revoked_at||!session.active||Date.parse(session.expires_at)<=now||now-Date.parse(session.last_activity_at)>config.sessionIdleMs){if(session&&!session.revoked_at)run("update vault_sessions set revoked_at=? where id=?",new Date().toISOString(),session.id);return null;} if(mutating&&(!csrf||sha256(csrf)!==session.csrf_hash))return null; run("update vault_sessions set last_activity_at=? where id=?",new Date().toISOString(),session.id); return {sessionId:session.id,userId:session.user_id,username:session.username,role:session.role}; }
export function rotateCsrf(sessionId:string){const csrf=randomBytes(24).toString("base64url");run("update vault_sessions set csrf_hash=? where id=?",sha256(csrf),sessionId);return csrf;}
export function logout(sessionId:string,userId:string,address:string){run("update vault_sessions set revoked_at=? where id=?",new Date().toISOString(),sessionId);audit({userId,action:"logout",result:"success",localAddress:address});}

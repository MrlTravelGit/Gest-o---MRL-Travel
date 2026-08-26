import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { config } from "./config.js";

const powershell = (operation: "Protect" | "Unprotect", input: Buffer, scope = "CurrentUser") => {
  if (process.platform !== "win32") throw new Error("DPAPI exige Windows. Nao existe fallback de chave em texto simples.");
  const script = `$ErrorActionPreference='Stop';Add-Type -AssemblyName System.Security;$raw=[Convert]::FromBase64String([Console]::In.ReadToEnd());$scope=[Security.Cryptography.DataProtectionScope]::${scope};$out=[Security.Cryptography.ProtectedData]::${operation}($raw,$null,$scope);[Console]::Out.Write([Convert]::ToBase64String($out))`;
  const encoded = Buffer.from(script,"utf16le").toString("base64");
  const result = spawnSync("powershell.exe",["-NoProfile","-NonInteractive","-EncodedCommand",encoded],{input:input.toString("base64"),encoding:"utf8",windowsHide:true,maxBuffer:1024*1024});
  if (result.status!==0 || !result.stdout.trim()) throw new Error("Falha ao acessar a chave protegida pelo Windows DPAPI.");
  return Buffer.from(result.stdout.trim(),"base64");
};
export const protectDpapi = (value: Buffer) => powershell("Protect",value);
export const unprotectDpapi = (value: Buffer) => powershell("Unprotect",value);
export const unprotectMachineDpapi = (value: Buffer) => powershell("Unprotect",value,"LocalMachine");
export function loadMasterKey() { if(!existsSync(config.masterKeyPath)) throw new Error("Cofre nao inicializado. Execute vault:init."); const key=unprotectDpapi(readFileSync(config.masterKeyPath)); if(key.length!==32) throw new Error("Chave mestra invalida."); return key; }
export function createMasterKey() { if(existsSync(config.masterKeyPath)) return loadMasterKey(); const key=randomBytes(32); writeFileSync(config.masterKeyPath,protectDpapi(key),{mode:0o600,flag:"wx"}); return key; }

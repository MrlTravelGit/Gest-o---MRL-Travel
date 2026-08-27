import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { isPrivateIpv4 } from "./config.js";

const root = resolve(import.meta.dirname, "../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
const server = read("src/server/server.ts");
const configSource = read("src/server/config.ts");
const start = read("scripts/start-vault.ps1");
const diagnose = read("scripts/diagnose-vault.ps1");
const acl = read("scripts/vault-acl.ps1");
const startCmd = read("INICIAR-COFRE.cmd");
const stopCmd = read("PARAR-COFRE.cmd");

describe("implantacao HTTP do cofre local", () => {
  it("usa HTTP nativo e oferece saude publica sem certificado", () => {
    expect(server).toContain('from "node:http"');
    expect(server).not.toContain('from "node:https"');
    expect(server).toContain('url.pathname==="/api/health"');
    expect(server).toContain('{status:"ok",service:"mrl-client-vault"}');
    expect(server).not.toMatch(/certPath|keyPath|unprotectDpapi|TLSv1/);
  });

  it("tem bind e URL publica canonicos sem pasta de certificados", () => {
    expect(configSource).toContain('process.env.VAULT_BIND_HOST || "0.0.0.0"');
    expect(configSource).toContain('process.env.VAULT_PUBLIC_URL || "http://192.168.0.25:7443"');
    expect(configSource).not.toMatch(/certPath|keyPath|certificates/);
  });

  it("restringe origens e cria cookie HTTP HttpOnly Strict", () => {
    for (const origin of ["http://127.0.0.1:7443", "http://localhost:7443", "http://192.168.0.25:7443"]) expect(configSource).toContain(origin);
    expect(configSource).not.toContain('"*"');
    expect(server).toContain("HttpOnly; SameSite=Strict");
    expect(server).not.toContain("Path=/; Secure;");
    expect(server).toContain("ORIGIN_NOT_ALLOWED");
  });

  it("preserva criptografia de conteudo e chave mestra DPAPI", () => {
    const crypto = read("src/server/crypto.ts");
    const dpapi = read("src/server/dpapi.ts");
    expect(configSource).toContain('masterKeyPath: join(dataDir, "master-key.dpapi")');
    expect(crypto).toMatch(/aes-256-gcm/i);
    expect(dpapi).toContain('scope = "CurrentUser"');
    expect(dpapi).toContain('DataProtectionScope]::${scope}');
  });

  it("localiza NSSM na ordem requerida e usa o runtime esperado", () => {
    const fixed = start.indexOf("D:\\Michael\\Tools\\NSSM\\nssm.exe");
    const environment = start.indexOf("$env:NSSM_PATH");
    const path = start.indexOf("Get-Command nssm.exe");
    expect(fixed).toBeGreaterThan(-1);
    expect(fixed).toBeLessThan(environment);
    expect(environment).toBeLessThan(path);
    expect(start).toContain("C:\\Program Files\\nodejs\\node.exe");
    expect(start).toContain("D:\\Michael\\Sistema Gestão - (Servidor Local)\\local-client-vault");
    expect(start).toContain("--env-file-if-exists=.env dist-server/server.js");
  });

  it("nao muda ObjectName nem opcoes extras de um servico existente", () => {
    const existingBranch = start.slice(start.indexOf("if ($service)"), start.indexOf("} else {", start.indexOf("if ($service)")));
    for (const setting of ["Application", "AppDirectory", "AppParameters", "AppStdout", "AppStderr", "AppRestartDelay"]) expect(existingBranch).toContain(`'${setting}'`);
    expect(existingBranch).not.toContain("ObjectName");
    expect(existingBranch).not.toContain("SERVICE_AUTO_START");
    expect(existingBranch).not.toContain("AppExit");
  });

  it("mantem firewall unico no perfil Private e subnet /24", () => {
    expect(start).toContain("MRL Client Vault LAN 7443");
    expect(start).toContain("192.168.0.0/24");
    expect(start).toContain("-Profile Private");
    expect(start).toContain("Remove-PortFirewallRules");
    expect(start).not.toMatch(/RemoteAddress[^\n]*\bAny\b/i);
  });

  it("trata Paused, valida health em 15 segundos e sanitiza logs", () => {
    expect(start).toContain("$currentStatus -eq 'Paused'");
    expect(start).toContain("Invoke-Nssm @('stop',$serviceName)");
    expect(start).toContain("AddSeconds(15)");
    expect(start).toContain("http://127.0.0.1:7443/api/health");
    expect(start).toContain("[REDACTED]");
  });

  it("oferece atalhos elevados de inicio e parada", () => {
    expect(startCmd).toContain("D:\\Michael\\Sistema Gest");
    expect(startCmd).toContain("local-client-vault\\INICIAR-COFRE.cmd");
    expect(startCmd).toContain('call "%CORRECT_LAUNCHER%"');
    expect(startCmd).toContain("pause");
    expect(stopCmd).toContain("local-client-vault\\PARAR-COFRE.cmd");
    expect(stopCmd).toContain('call "%CORRECT_LAUNCHER%"');
  });

  it("expoe lista, sincronizacao manual e retry autenticados", () => {
    expect(server).toContain('url.pathname==="/api/clients"');
    expect(server).toContain('url.pathname==="/api/sync/clients/run"');
    expect(server).toContain('/retry-sync');
    expect(server.indexOf('SESSION_REQUIRED')).toBeLessThan(server.indexOf('url.pathname==="/api/clients"'));
    expect(server).toContain('requireRole(session!.role,["vault_admin"])');
  });

  it("nao mantem TLS nas rotinas ativas", () => {
    const active = [server, configSource, start, diagnose, read("scripts/install-service.ps1"), read("vite.config.ts"), read(".env.example"), startCmd, stopCmd].join("\n");
    expect(active).not.toMatch(/new-local-certificate|vault\.crt|vault\.key\.dpapi|mrl-vault-ca|https:\/\/(?:127\.0\.0\.1|192\.168\.0\.25):7443/);
  });

  it("preserva a correcao de conta local no Windows em portugues", () => {
    expect(acl).toContain("StartsWith('.\\'");
    expect(acl).toContain("Substring(2)");
    expect(acl).toContain("[System.Security.Principal.NTAccount]::new($qualifiedAccount)");
    if (process.platform !== "win32") return;
    const helper = resolve(root, "scripts/vault-acl.ps1").replaceAll("'", "''");
    const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `. '${helper}'; ConvertTo-QualifiedWindowsAccount -AccountName '.\\michael' -ComputerName 'CLAUDE'`], { encoding: "utf8", windowsHide: true });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.trim()).toBe("CLAUDE\\michael");
  });

  it("aceita somente IPv4 privado como endereco especifico", () => {
    expect(isPrivateIpv4("192.168.0.25")).toBe(true);
    expect(isPrivateIpv4("10.20.30.40")).toBe(true);
    expect(isPrivateIpv4("172.31.1.2")).toBe(true);
    expect(isPrivateIpv4("8.8.8.8")).toBe(false);
    expect(isPrivateIpv4("127.0.0.1")).toBe(false);
  });
});

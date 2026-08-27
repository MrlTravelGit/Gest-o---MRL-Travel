import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { isPrivateIpv4 } from "./config.js";

const root = resolve(import.meta.dirname, "../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
const start = read("scripts/start-vault.ps1");
const stop = read("scripts/stop-vault.ps1");
const diagnose = read("scripts/diagnose-vault.ps1");
const server = read("src/server/server.ts");
const configSource = read("src/server/config.ts");
const envExample = read(".env.example");
const launcher = read("INICIAR-COFRE.cmd");
const stopper = read("PARAR-COFRE.cmd");

describe("implantacao HTTP local do cofre", () => {
  it("aceita bind all-interfaces e somente IPv4 privado para binds especificos", () => {
    expect(isPrivateIpv4("192.168.0.25")).toBe(true);
    expect(isPrivateIpv4("10.20.30.40")).toBe(true);
    expect(isPrivateIpv4("172.31.1.2")).toBe(true);
    expect(isPrivateIpv4("8.8.8.8")).toBe(false);
    expect(isPrivateIpv4("169.254.1.8")).toBe(false);
    expect(isPrivateIpv4("127.0.0.1")).toBe(false);
    expect(configSource).toContain('host !== "0.0.0.0"');
  });

  it("usa servidor HTTP nativo sem carregar chave ou certificado TLS", () => {
    expect(server).toContain('from "node:http"');
    expect(server).not.toContain('from "node:https"');
    expect(server).not.toContain("cert:");
    expect(server).not.toContain("minVersion");
    expect(server).not.toContain("unprotectDpapi(readFileSync(config.keyPath))");
    expect(configSource).not.toContain("certPath");
    expect(configSource).not.toContain("keyPath");
  });

  it("publica health aberto e loga a URL HTTP oficial", () => {
    expect(server).toContain('url.pathname==="/api/health"');
    expect(server).toContain('transport:"http"');
    expect(server).toContain("MRL Vault ativo em ${config.publicUrl}");
    expect(configSource).toContain('"http://192.168.0.25:7443"');
  });

  it("mantem sessoes HttpOnly SameSite Strict sem Secure no HTTP local", () => {
    expect(server).toContain("HttpOnly; SameSite=Strict");
    expect(server).not.toContain("Path=/; Secure; HttpOnly");
    expect(server).not.toContain("localStorage");
  });

  it("permite somente origens HTTP locais necessarias", () => {
    expect(configSource).toContain('"http://127.0.0.1:7443"');
    expect(configSource).toContain('"http://localhost:7443"');
    expect(configSource).toContain('"http://192.168.0.25:7443"');
    expect(server).toContain("config.allowedOrigins.includes(origin)");
    expect(server).not.toContain('"*"');
  });

  it("start-vault nao chama nem valida certificados e preserva ObjectName existente", () => {
    expect(start).not.toContain("new-local-certificate.ps1");
    expect(start).not.toContain("Set-EnvValue $envPath 'VAULT_CERT_PATH'");
    expect(start).not.toContain("Set-EnvValue $envPath 'VAULT_KEY_PATH'");
    expect(start).not.toContain("certificates");
    expect(start).not.toContain("vault.crt");
    expect(start).not.toContain("vault.key.dpapi");
    expect(start).toContain("$newService = -not $service");
    expect(start.indexOf("if ($newService)")).toBeLessThan(start.indexOf("ObjectName"));
  });

  it("aplica ACL segura ao banco e logs antes de iniciar o servico", () => {
    expect(start).toContain("Resolve-VaultServiceSid");
    expect(start).toContain("Set-VaultDirectoryAcl -Paths @($dataRoot,$logRoot)");
    expect(start.indexOf("Set-VaultDirectoryAcl")).toBeLessThan(start.indexOf("& $nssm start $serviceName"));
  });

  it("expoe lista e colecoes protegidas somente depois da sessao", () => {
    expect(server).toContain('url.pathname==="/api/clients"');
    expect(server).toContain('(cards|passports|visas)');
    expect(server.indexOf("SESSION_REQUIRED")).toBeLessThan(server.indexOf('url.pathname==="/api/clients"'));
    expect(server).toContain('input.purpose==="copy"');
    expect(server).toContain('?"view":"download"');
  });

  it("configura NSSM, health, porta pausada e firewall conforme a LAN", () => {
    expect(start).toContain("D:\\Michael\\Tools\\NSSM\\nssm.exe");
    expect(start).toContain("$env:NSSM_PATH");
    expect(start).toContain("Get-Command nssm.exe");
    expect(start).toContain("Application $node");
    expect(start).toContain("AppDirectory $appRoot");
    expect(start).toContain("AppParameters '--env-file-if-exists=.env dist-server/server.js'");
    expect(start).toContain("AppStdout");
    expect(start).toContain("AppStderr");
    expect(start).toContain("AppRestartDelay");
    expect(start).toContain("if ($service.Status -eq 'Paused')");
    expect(start).toContain("http://127.0.0.1:7443/api/health");
    expect(start).toContain("'MRL Client Vault LAN 7443'");
    expect(start).toContain("-RemoteAddress '192.168.0.0/24'");
    expect(start).toContain("-Profile Private");
    expect(start).not.toContain("LocalSubnet");
  });

  it("arquivos de um clique elevam, iniciam, param e mostram as URLs HTTP", () => {
    expect(launcher).toContain("fltmc");
    expect(launcher).toContain("Verb RunAs");
    expect(launcher).toContain("scripts\\start-vault.ps1");
    expect(launcher).toContain("Cofre iniciado com sucesso.");
    expect(launcher).toContain("http://127.0.0.1:7443");
    expect(launcher).toContain("http://192.168.0.25:7443");
    expect(stopper).toContain("Verb RunAs");
    expect(stopper).toContain("scripts\\stop-vault.ps1");
    expect(stop).not.toContain("certificados");
  });

  it("diagnostico e exemplo de env seguem o contrato HTTP sem segredos", () => {
    expect(diagnose).toContain("http://127.0.0.1:7443/api/health");
    expect(diagnose).toContain("'MRL Client Vault LAN 7443'");
    expect(diagnose).toContain("192.168.0.0/24");
    expect(diagnose).not.toContain("vault.crt");
    expect(diagnose).not.toContain("https://");
    expect(envExample).toContain("VAULT_BIND_HOST=0.0.0.0");
    expect(envExample).toContain("VAULT_PUBLIC_URL=http://192.168.0.25:7443");
    expect(envExample).not.toContain("VAULT_CERT_PATH");
    expect(envExample).not.toContain("VAULT_KEY_PATH");
    expect(envExample).not.toMatch(/password|secret|token/i);
  });
});

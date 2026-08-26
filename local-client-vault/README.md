# Cofre Local MRL Travel

Aplicação independente instalada somente no servidor Windows `192.168.0.25`. As estacoes administrativas acessam `http://192.168.0.25:7443` exclusivamente pelo navegador na rede local e nao recebem projeto, banco, documentos, segredos ou servico local.

## Inicialização simples

- `INICIAR-COFRE.cmd`: instala, repara ou inicia o serviço permanente com elevação UAC quando necessária.
- `PARAR-COFRE.cmd`: para somente `MRLClientVault` após confirmação.
- `DIAGNOSTICAR-COFRE.cmd`: verifica serviço, rede, HTTPS, firewall, build, permissões e logs sem alterar dados.

O funcionamento normal não depende desses arquivos: o NSSM mantém o serviço automático e o reinicia em caso de falha. O servidor pode funcionar sem usuário conectado ao Windows.

## Segurança

- Autenticação local por usuário e senha, mínimo de 15 caracteres e Argon2id.
- Bloqueio progressivo apos cinco falhas, revogacao administrativa e sessoes `HttpOnly` e `SameSite=Strict`. O cookie usa `Secure=false` somente nesta implantacao HTTP local.
- AES-256-GCM para campos e documentos; chave mestra vinculada à conta do serviço pelo DPAPI.
- Autoridade certificadora estável, chaves privadas protegidas pelo DPAPI e ACL restrita, certificado renovável com SAN da rede privada.
- Firewall TCP 7443 somente no perfil Private, limitado a `192.168.0.0/24`.

## Desenvolvimento

Requer Windows 11/Server, Node.js 24 LTS, PowerShell 7 e NSSM no servidor.

```powershell
npm ci
npm run typecheck
npm test
npm run build
```

Leia [o runbook do PATCH 033](../../docs/PATCH_033_LOCAL_VAULT_PERMANENT_SERVER.md) antes da implantação.

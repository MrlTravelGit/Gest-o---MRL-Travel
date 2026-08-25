# MRL Client Vault (somente local)

Aplicação independente para dados pessoais, credenciais e documentos dos clientes. Ela não integra o build nem o deploy do site principal e está excluída do Vercel. O servidor aceita apenas HTTPS, usa `127.0.0.1` por padrão e mantém os anexos fora da raiz web.

## Controles principais

- AES-256-GCM por campo e chave aleatória por arquivo, embrulhada pela chave mestra.
- Chave mestra protegida pelo Windows DPAPI `CurrentUser`, portanto vinculada à conta que executa o serviço.
- Senhas Argon2id, MFA TOTP obrigatório, sessão aleatória armazenada somente como hash e cookie `Secure; HttpOnly; SameSite=Strict`.
- Expiração por 10 minutos sem atividade e limite absoluto de 8 horas; bloqueio progressivo de login.
- Perfis `vault_admin`, `vault_operator` e `vault_auditor`. O auditor não lê conteúdo protegido; exclusão lógica de documentos exige administrador.
- Verificação de assinatura/MIME, limite de 25 MB, quarentena e Microsoft Defender antes de cifrar.
- Auditoria sem conteúdo sensível para login, leitura/cópia, alterações, importação, exclusão e backup.

Antes da instalação, leia [o modelo de ameaças](../../docs/PATCH_032_THREAT_MODEL.md) e [o runbook](../../docs/PATCH_032_LOCAL_VAULT_OPERATIONS.md).

## Desenvolvimento

Requer Windows 11/Server, Node 24 LTS e PowerShell 7.

```powershell
npm install
npm run typecheck
npm test
npm run build
```

O cofre não possui fallback de chave fora do DPAPI e falha fechado se o Defender não estiver disponível. Não versionar `.env`, `data`, certificados ou backups.

# PATCH 032 — instalação e operação do cofre local

## Pré-requisitos e identidade

Use uma estação Windows dedicada, BitLocker ativo, Windows Update/Defender atualizados e uma conta local exclusiva, por exemplo `MRLVaultSvc`, sem login interativo e com senha longa guardada no cofre corporativo. A mesma conta deve criar a chave, inicializar o administrador, executar o serviço, sincronizar e realizar backup; DPAPI `CurrentUser` impede outra conta de abrir a chave mestra.

Instale Node 24 LTS, PowerShell 7 e NSSM de fonte verificada. Copie apenas `apps/local-client-vault` para um diretório local protegido por ACL. Nunca copie essa pasta para o repositório de publicação ou para uma pasta sincronizada em nuvem.

## Instalação

1. Entre uma vez com a conta de serviço (ou use `runas`) e execute `npm ci` e `npm run build` em `apps/local-client-vault`.
2. Copie `.env.example` para `.env`, ajuste apenas origens/paths não secretos e mantenha `VAULT_BIND_HOST=127.0.0.1`.
3. Execute `pwsh scripts/new-local-certificate.ps1`. O certificado é confiado somente no usuário atual. A chave privada deve receber ACL exclusiva da conta do serviço.
4. Execute `npm run vault:init`. Cadastre o URI TOTP imediatamente; guarde a recuperação em mídia física protegida. A senha vira apenas hash Argon2id.
   Use `npm run vault:create-user` sob a conta de serviço para cadastrar operadores e auditores. Revise trimestralmente os perfis e desative no banco local qualquer conta sem necessidade atual.
5. Crie no Supabase uma identidade técnica exclusiva de baixo privilégio, inclua seu UUID em `vault_sync_agents` e gere uma sessão renovável conforme a política da organização. Como a CLI recebe o token interativamente, execute `npm run vault:set-agent`; o arquivo gerado fica protegido pelo DPAPI. Não use `service_role`.
6. Como administrador, execute `scripts/install-service.ps1`. O script instala via NSSM e adiciona uma regra de bloqueio de entrada externa. Valide `Get-NetTCPConnection -LocalPort 7443`: o endereço deve ser somente `127.0.0.1`.
7. Execute `scripts/install-backup-task.ps1` com a mesma conta. Inicie `MRLClientVault` e agende `npm run sync` sob essa identidade a cada 2–5 minutos.
8. No app principal configure `VITE_LOCAL_VAULT_URL=https://127.0.0.1:7443` antes do build administrativo. A URL enviada contém somente `/clients/{client_id}`; nenhum token Supabase é repassado.

## Permissões e provisão

Conceda `staff_vault_permissions.vault_access=true` somente a funcionários aprovados. O botão “Abrir dados protegidos” não renderiza para os demais. A própria autenticação do cofre continua obrigatória, inclusive para quem possui a permissão do painel.

Criação/alteração de cliente ou vigência produz um evento mínimo e transacional na outbox: UUID do evento/cliente, nome de exibição, datas, tipo e horário. O agente autenticado reivindica eventos, faz `UPSERT` idempotente por `client_id`, cria LATAM Pass, Livelo, Azul Fidelidade, Smiles e Esfera, e confirma o evento. Arquivar preserva o conteúdo local.

## Backup, restauração e rotação

`npm run vault:backup` cria um contêiner AES-256-GCM e checksum SHA-256. A retenção mantém 7 cópias diárias, 4 semanais e 12 mensais. Copie os backups para mídia offline cifrada; como a chave de backup é derivada da mestra DPAPI atual, mantenha imagem/credenciais protegidas da conta de serviço ou faça restauração no mesmo perfil Windows.

Teste trimestralmente em diretório vazio:

```powershell
npm run vault:restore -- 'D:\VaultBackups\mrl-vault-....vault-backup' 'D:\VaultRestoreTest'
```

A restauração recusa destino não vazio e travessia de paths. Compare o checksum, abra uma cópia isolada e registre a evidência. Para rotação após suspeita de chave, desligue o serviço, exporte backup verificado, crie perfil Windows/instalação novos, restaure e recifre sob uma nova chave; revogue todas as sessões e a identidade técnica antiga.

## Importação assistida

Primeiro gere somente a prévia: `npm run vault:import -- 'D:\PastasClientes'`. Revise o relatório local e crie JSON explícito `{ "Nome exato da pasta": "uuid-do-cliente" }`. Só então use `--apply --mapping=...`; a frase de confirmação inclui a contagem. Arquivos não permitidos ficam bloqueados, todos passam pelo Defender, e as origens permanecem intactas.

## Resposta a incidentes

Desligue o serviço e isole a estação da rede. Preserve DB, anexos cifrados, audit log e Windows Event Log sem abrir segredos. Revogue a identidade técnica e permissões, troque credenciais potencialmente reveladas e trate cópia do perfil da conta de serviço como comprometimento da chave. Consulte o modelo de ameaças para riscos residuais.

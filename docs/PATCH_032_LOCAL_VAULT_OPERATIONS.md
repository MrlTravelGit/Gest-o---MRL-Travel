# PATCH 032 — instalação e operação do cofre local

## Pré-requisitos e identidade

Use uma estação Windows dedicada, BitLocker ativo, Windows Update/Defender atualizados e uma conta local exclusiva, por exemplo `MRLVaultSvc`, sem login interativo e com senha longa guardada no cofre corporativo. A mesma conta deve criar a chave, inicializar usuários, executar o serviço, sincronizar e realizar backup; DPAPI `CurrentUser` vincula a chave mestra a esse perfil Windows.

Instale Node 24 LTS, PowerShell 7 e NSSM de fonte verificada. Copie apenas `apps/local-client-vault` para um diretório local protegido por ACL. Nunca use repositório de publicação ou pasta sincronizada em nuvem.

## Rede privada, nome e certificado

1. Reserve no DHCP um IP privado fixo para o servidor, por exemplo `192.168.1.50`.
2. Faça `mrl-vault.local` resolver para esse IP nos computadores administrativos autorizados, por DNS interno ou arquivo `hosts` administrado.
3. Copie `.env.example` para `.env`, substitua `VAULT_BIND_HOST` pelo IP privado fixo e mantenha `VAULT_PUBLIC_ORIGIN=https://mrl-vault.local:7443`.
4. Sob a conta do serviço, execute `pwsh scripts/new-local-certificate.ps1 -ServerPrivateIp 192.168.1.50`. O SAN conterá localhost, 127.0.0.1, `mrl-vault.local` e o IP informado.
5. Aplique ACL exclusiva da conta do serviço a `vault.key`. Copie aos clientes somente `vault.crt` e importe-o em “Autoridades de Certificação Raiz Confiáveis” do usuário autorizado. Nunca copie `vault.key`.
6. Não configure NAT, encaminhamento de porta, túnel público, perfil Public ou endereço de internet.

## Instalação e usuários

```powershell
cd apps/local-client-vault
npm ci
npm run build
npm run vault:init
```

O primeiro administrador é criado somente pela CLI local. A autenticação usa exclusivamente usuário e senha, com mínimo de 15 caracteres e hash Argon2id.

Comandos administrativos locais:

```powershell
npm run vault:create-user
npm run vault:unlock-user
npm run vault:disable-user
npm run vault:enable-user
npm run vault:revoke-sessions
```

Após cinco falhas consecutivas, a conta recebe bloqueio temporário progressivo. `vault:unlock-user` remove o bloqueio e audita a ação. Desativar um usuário revoga todas as sessões dele. Execute `vault:revoke-sessions` depois de rotação de chave ou incidente.

## Serviço e firewall

Instale o serviço informando explicitamente todos os IPs administrativos autorizados:

```powershell
pwsh scripts/install-service.ps1 `
  -ServiceAccount '.\MRLVaultSvc' `
  -ServicePassword (Read-Host -AsSecureString) `
  -AllowedRemoteAddress @('192.168.1.21','192.168.1.22')
```

O script remove apenas regras antigas com os nomes específicos do MRL Vault, instala o serviço NSSM com leitura do `.env` e cria uma regra TCP 7443, perfil Private, limitada à allowlist. Valide com `Get-NetTCPConnection -LocalPort 7443`; o endereço local deve ser o IP privado configurado. De um computador fora da lista, a conexão deve falhar.

No painel principal, configure `VITE_LOCAL_VAULT_URL=https://mrl-vault.local:7443`. A nova aba recebe somente `/clients/{client_id}`; nenhuma sessão ou token Supabase é repassado.

## Identidade técnica e sincronização

Crie no Supabase uma identidade técnica exclusiva de baixo privilégio, inclua seu UUID em `vault_sync_agents` e use uma sessão renovável conforme a política da organização. Execute `npm run vault:set-agent`; o token será protegido pelo DPAPI e nunca irá ao frontend. Não use `service_role` no cofre.

Agende `npm run sync` sob a conta do serviço a cada 2–5 minutos. O agente consome apenas eventos mínimos da outbox, grava por `client_id` de modo idempotente e só confirma após a transação local. Arquivamento preserva os dados.

## Backup, restauração e rotação

Execute `scripts/install-backup-task.ps1` com a mesma conta. `npm run vault:backup` cria contêiner AES-256-GCM e checksum SHA-256; a retenção mantém 7 diários, 4 semanais e 12 mensais. Use segundo disco ou compartilhamento privado protegido, nunca nuvem pública.

Teste trimestralmente em diretório vazio:

```powershell
npm run vault:restore -- 'D:\VaultBackups\mrl-vault-....vault-backup' 'D:\VaultRestoreTest'
```

A restauração rejeita destino não vazio e travessia de paths. Para rotação, desligue o serviço, gere backup verificado, recifre/restaure sob a nova chave, execute `npm run vault:revoke-sessions` e revogue a identidade técnica anterior.

## Importação assistida

Gere primeiro a prévia: `npm run vault:import -- 'D:\PastasClientes'`. Revise o relatório local e crie JSON explícito `{ "Nome exato da pasta": "uuid-do-cliente" }`. Só então use `--apply --mapping=...`; a confirmação inclui a contagem. As origens permanecem intactas.

## Resposta a incidentes

Desligue o serviço, isole a estação da rede, preserve DB/anexos cifrados/auditoria/Event Log, revogue a identidade técnica e sessões, troque credenciais potencialmente reveladas e trate cópia do perfil da conta do serviço como comprometimento da chave. Consulte o modelo de ameaças antes da retomada.

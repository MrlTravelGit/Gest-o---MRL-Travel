# Patch MRL 032 — Modelo de ameaças do cofre local

Data: 25/08/2026

## Fronteiras de confiança

- O painel principal e o Supabase guardam somente `client_id`, vigências, eventos mínimos da outbox e a permissão `vault_access`.
- O cofre, sua autenticação, dados pessoais, credenciais, anexos, chaves e backups permanecem na rede local autorizada.
- O agente local inicia conexões de saída para consumir eventos; a nuvem nunca inicia conexões para a rede local.

## Ameaças e controles

| Ameaça | Impacto | Controles obrigatórios | Risco residual |
| --- | --- | --- | --- |
| Perda ou furto do computador | Cópia física do banco e anexos | BitLocker, conta de serviço dedicada, AES-256-GCM por valor/arquivo, chave mestra protegida por DPAPI, bloqueio automático e firewall | A sessão Windows já desbloqueada ainda exige resposta operacional imediata |
| Roubo da base ou do diretório de anexos | Tentativa de leitura offline | Nenhum dado sensível em claro; nonce único; chaves de arquivo envelopadas; nomes físicos UUID; backups criptografados | Metadados operacionais mínimos podem revelar volume e horários |
| Comprometimento da conta Windows do serviço | Acesso à chave protegida por DPAPI | Privilégio mínimo, logon interativo negado, senha longa Argon2id, rotação/revogação, Defender e auditoria fora do alcance de operadores | Administrador local comprometido continua sendo ameaça crítica |
| Usuário interno indevido | Revelação ou cópia não autorizada | RBAC, escopo por cliente, senha individual, reautenticação para ações críticas, segredo sob demanda e auditoria sem conteúdo | Captura manual após revelação autorizada não pode ser eliminada totalmente |
| Arquivo malicioso | Execução de malware ou exploração de parser | Allowlist de formatos, assinatura/MIME real, limite, quarentena, Microsoft Defender antes da criptografia, nunca servir por caminho direto | Zero-days no mecanismo antimalware ou visualizador local |
| Exposição da porta local | Acesso remoto ao serviço | HTTPS, bind em loopback ou IP privado explícito, firewall por origem, sem NAT/túnel, autenticação independente e cookies seguros | Configuração incorreta de rede/firewall exige auditoria periódica |
| Backup perdido ou corrompido | Indisponibilidade e perda definitiva | Checksum, retenção 7/4/12, segundo disco/rede protegida, testes de restauração isolados e cópia de recuperação física separada | Falha simultânea dos meios de backup e recuperação |
| Chave mestra comprometida | Descriptografia dos dados copiados | DPAPI, acesso restrito, rotação com reenvelopamento, revogação de sessões, procedimento de incidente e backup separado | Banco, chave e controle da conta de serviço juntos constituem comprometimento grave |

## Decisões de segurança

- O `client_id` identifica o cliente, mas nunca autoriza acesso.
- Senhas administrativas usam hash Argon2id; segredos recuperáveis usam criptografia autenticada.
- Segredos não são pré-carregados no HTML e só são descriptografados para uma solicitação autenticada e auditada.
- Exclusões são lógicas; purga definitiva exige `vault_admin`, reautenticação e justificativa.
- Não existe fallback público, sincronização automática com nuvem ou segredo em variáveis `VITE_*`.

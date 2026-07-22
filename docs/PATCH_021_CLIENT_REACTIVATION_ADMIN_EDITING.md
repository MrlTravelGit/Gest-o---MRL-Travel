# PATCH 021 — Reativação e edição administrativa de clientes

Data: 21/07/2026  
Versão: 0.4.6  
Migration: `202607210023_client_reactivation_and_admin_editing.sql`

## Auditoria do estado anterior

- O status de arquivamento existente é `clients.status = 'ended'`; não foi criado um enum paralelo `archived`.
- O enum real de clientes contém `lead`, `active`, `paused` e `ended`.
- O enum real de contratos contém `draft`, `active`, `paused`, `ended` e `cancelled`.
- `archive_client` encerrava o cliente e os contratos, mas não registrava data, responsável ou motivo do arquivamento.
- O PATCH 020 preservou intencionalmente os status encontrados na conciliação Iddas: 12 cadastros preexistentes permaneceram arquivados e Leonardo permaneceu lead. A importação não duplicou clientes nem causou uma transição nova em massa.
- A frase “ainda aguarda revisão e ativação” vinha do `LeadActivationBanner` no frontend. Ela era concatenada ao nome somente no título visual; a rotina de limpeza cobre separadamente os casos em que complementos semelhantes tenham sido persistidos em dados legados.
- O ledger oficial permanece em `point_transactions` e `balance_snapshots`; `program_accounts` continua sendo a conta canônica por programa.
- O painel público exige cliente ativo. A ausência de contrato vigente gera apenas o aviso `Contrato pendente de revisão` e não bloqueia a leitura por link.

## Modelo adotado

O conceito existente foi evoluído sem tabela ou status concorrente:

| Conceito funcional | Representação canônica |
| :--- | :--- |
| Lead aguardando ativação | `clients.status = 'lead'` |
| Cliente ativo | `clients.status = 'active'` |
| Cliente arquivado | `clients.status = 'ended'` |
| Contrato pendente | `clients.contract_review_status = 'pending_review'` |
| Contrato revisado | `clients.contract_review_status = 'complete'` |
| Prazo indeterminado | `management_contracts.ends_on is null` |

Os campos de arquivamento (`archived_at`, `archived_by`, `archive_reason`) guardam o estado atual. O valor anterior é preservado em `audit_logs` durante a reativação.

## Backend e segurança

As operações administrativas são feitas por funções `security definer`, com `search_path` fixo, autenticação real por `auth.uid()` e validação de integrante ativo com papel `super_admin` ou `manager`.

RPCs adicionadas ou evoluídas:

- `get_client_reactivation_preview`
- `reactivate_client_admin`
- `bulk_reactivate_clients_admin`
- `get_admin_client_management`
- `update_client_profile_admin`
- `update_client_contract_admin`
- `preview_client_name_cleanup_admin`
- `apply_client_name_cleanup_admin`
- `revert_client_name_cleanup_admin`
- `get_client_name_cleanup_history_admin`
- `get_admin_clients`
- `archive_client`

`update_client_profile_admin` é executada somente por `service_role` dentro da Edge Function `admin-client-management`. A função autentica o administrador, valida o payload com Zod e protege CPF/CNPJ com AES-GCM e hash antes de chamar a RPC. Valores de documento, e-mail, telefone, WhatsApp, endereço e observações não são gravados nos logs técnicos.

As tabelas `client_reactivation_batches`, `client_reactivation_batch_items` e `client_name_cleanup_actions` têm RLS forçada e nenhum acesso direto para `anon` ou `authenticated`. Escritas diretas autenticadas em `clients`, `client_addresses` e `management_contracts` também foram revogadas; as mutações passam pelas operações autorizadas.

## Atomicidade e idempotência

- Cada reativação bloqueia a linha do cliente e compara `row_version` quando fornecida.
- A operação não insere cliente, contrato, conta, snapshot, movimento ou link.
- Pontos e quantidade de programas são calculados antes e depois; qualquer divergência aborta a transação daquele cliente.
- Cliente já ativo retorna `already_active`, sem nova alteração.
- O lote usa uma subtransação por cliente, registra resultado individual e não desfaz sucessos anteriores por uma falha posterior.
- Leads são bloqueados pela validação do estado canônico.
- Contrato existente e ainda vigente é reativado; ausência de vigência confiável resulta em `pending_review`, sem datas inventadas.
- Limpeza de nome é aplicada somente após prévia individual, é idempotente e possui reversão auditada.

## Interface administrativa

- A listagem possui contadores e filtros para todos, ativos, aguardando ativação, arquivados e contrato pendente.
- Apenas linhas arquivadas podem ser selecionadas para reativação em lote.
- A prévia informa contratos, pontos e programas que serão preservados; o resultado pode ser baixado em JSON.
- O detalhe de um arquivado mostra a ação individual com confirmação explícita.
- O título do lead mostra apenas o nome; badge e texto de apoio são componentes separados.
- `/admin/clientes/:clientId/editar` oferece dados pessoais, endereço, situação, contrato, link do painel e resumo financeiro somente leitura.
- Alterações de vigência exigem motivo; fim anterior ao início e concorrência são bloqueados.
- Gerar, rotacionar ou revogar o link continuam ações explícitas e separadas da edição.

## Compatibilidade entre reativação e link público

- `admin-direct-access-link` permite gerar e rotacionar links para qualquer cliente com `clients.status = 'active'`, independentemente de `contract_review_status`.
- `get-client-dashboard-by-link` valida o token e o status ativo do cliente, mas não exige vigência contratual para a leitura do dashboard.
- Leads e clientes arquivados continuam impedidos de gerar e utilizar o painel público.
- A tela administrativa exibe `Contrato pendente de revisão` quando não há vigência ativa (mesmo se o marcador histórico estiver concluído) e oferece atalho para `#contrato`, sem criar datas ou contratos automáticos.
- Operações juridicamente dependentes de vigência continuam usando suas validações contratuais existentes.
- Esta correção não cria migration e não escreve em clientes, programas, saldos ou movimentações.

## Verificação local

| Verificação | Resultado |
| :--- | :--- |
| `npx supabase db reset --local` | migration 023 aplicada desde banco vazio |
| `npx supabase test db supabase/tests --local` | 6 arquivos, 146 testes aprovados |
| Teste específico do PATCH 021 | 56/56 aprovados |
| `npm test -- --run` | 25 arquivos, 85 testes aprovados |
| `npm run typecheck` | aprovado |
| `npm run build` | aprovado |
| Deno check das duas Edge Functions | aprovado |
| `git diff --check` | aprovado, exceto avisos esperados de LF/CRLF no Windows |

## Publicação

O projeto vinculado é `bdkazlhvnowjehdgxege`. A comprovação remota deve registrar migration 023, versões publicadas das funções, totais antes/depois, relatórios individual e em lote e validação visual em desktop/celular. Enquanto algum desses itens estiver pendente, o patch não deve ser tratado como concluído em produção.

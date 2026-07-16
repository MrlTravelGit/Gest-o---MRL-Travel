# Dicionário do banco de dados

## Estruturas adicionadas ou evoluídas na versão 0.4.0

| Estrutura | Tipo | Uso |
| :--- | :--- | :--- |
| `loyalty_club_plans` | tabela | Catálogo versionado de planos de clube por programa, com pontos mensais, vigência, fonte oficial e status |
| `loyalty_club_plan_benefits` | tabela | Benefícios descritivos e estruturados por plano, ordenáveis e versionáveis |
| `loyalty_status_tiers` | tabela | Categorias/status por programa, separadas dos planos de clube |
| `client_club_subscriptions` | tabela | Assinatura do cliente em um plano, vinculada à conta do programa do próprio cliente |
| `scheduled_point_credits` | tabela | Previsões de crédito por competência; não alteram saldo até confirmação |
| `client_direct_access_links` | tabela | Links diretos com hash do token, status, expiração, revogação e contador de uso |
| `client_direct_access_events` | tabela | Eventos minimizados de troca de link, rate limit, falhas e sucesso |
| `card_statements` | evolução | Fechamento/vencimento, moeda, snapshot da regra, cotação, fonte, cancelamento e idempotência |
| `point_transactions` | evolução | Estado, estorno vinculado, motivo de correção e autor/data da correção |

Todas as tabelas novas possuem RLS habilitado e forçado. Consultas de cliente dependem de `auth.uid()` resolvido por `client_users`; mutações administrativas passam por RPCs `security definer` com `search_path` fixo e checagem de `staff_members`.

### RPCs da versão 0.4.0

| Função | Responsabilidade |
| :--- | :--- |
| `get_club_catalog` | Lista planos, benefícios e categorias do catálogo versionado |
| `upsert_client_club_subscription` | Cria/atualiza assinatura, valida pertencimento e gera previsão inicial |
| `get_client_club_subscriptions` | Lista assinaturas e previsões de crédito com filtros |
| `confirm_scheduled_point_credit` | Confirma crédito previsto e cria uma transação real idempotente |
| `get_card_statement_options` | Retorna clientes, cartões, programas e regras para lançamento de faturas |
| `upsert_credit_card` | Cria/atualiza cartão e regra vigente sem armazenar PAN/CVV |
| `record_card_statement` | Grava fatura e cálculo oficial de pontos esperados com snapshot |
| `get_card_statements` | Lista faturas por cliente, cartão, período e status |
| `get_point_movements` | Consulta o histórico canônico baseado em `point_transactions` |
| `void_point_transaction` | Estorna lançamento confirmado preservando o original |
| `create_client_direct_access_link` | Gera registro do link direto armazenando apenas hash |
| `revoke_client_direct_access_link` | Revoga link direto com motivo auditável |
| `get_client_direct_access_links` | Lista links diretos administrativos sem token bruto |
| `get_my_client_dashboard` | Retorna o dashboard do cliente autenticado sem depender de `public_id` na rota |

## Identidade e acesso

| Tabela | Uso |
| :--- | :--- |
| `profiles` | Dados mínimos do usuário autenticado |
| `staff_members` | Função e status da equipe |
| `clients` | Cadastro principal e `public_id` |
| `client_addresses` | Endereço principal normalizado; leitura restrita à equipe |
| `client_users` | Associação segura entre cliente e usuário |
| `client_access_challenges` | Desafios temporários de código |
| `client_access_attempts` | Controle de tentativas sem armazenar nome ou IP em texto puro |
| `login_events` | Histórico de autenticação |

## Gestão

| Tabela | Uso |
| :--- | :--- |
| `management_contracts` | Vigência e situação do contrato |
| `tasks` | Pendências e alertas operacionais |
| `notifications` | Histórico de comunicações |
| `attachments` | Metadados dos arquivos privados |
| `audit_logs` | Alterações administrativas |

## Cartões

| Tabela | Uso |
| :--- | :--- |
| `credit_cards` | Emissor, produto e quatro últimos dígitos |
| `card_earning_rules` | Regra de pontos e vigência |
| `card_statements` | Gasto, pontos esperados, recebidos e divergência |

## Fidelidade

| Tabela | Uso |
| :--- | :--- |
| `loyalty_programs` | Catálogo dos programas |
| `program_accounts` | Programas vinculados ao cliente |
| `balance_snapshots` | Histórico de saldos e patrimônio |
| `point_transactions` | Movimentações de pontos |
| `expiration_lots` | Quantidades e datas de vencimento |
| `transfers` | Transferências e bônus |

### Estruturas adicionadas ou evoluídas na versão 0.3.0

| Estrutura | Alteração | Regra |
| :--- | :--- | :--- |
| `clients` | `birth_date` | Não aceita data futura na criação |
| `client_addresses` | nova tabela | Um endereço principal por cliente, RLS forçada e auditoria sem PII |
| `travel_interests` | nova tabela | Período consistente e quatro estados operacionais |
| `redemptions` | modo, data, operação e conta/pontos | Fonte única de viagens e economia; operação em milhas pode baixar atomicamente |
| `transfers` | paridade, base, bônus, datas e operação | Evolução in-place, concluída no salvamento |
| `point_entry_category` | `manual_exit` | Saída excepcional no mesmo ledger |

### Campos adicionados na versão 0.2.0

| Estrutura | Campo | Regra |
| :--- | :--- | :--- |
| `program_accounts` | `club_active` | Clube ativo por conta de programa, padrão `false` |
| `program_accounts` | `club_updated_at` | Momento da última alteração do clube |
| `point_transactions` | `entry_category` | Categoria administrativa da entrada |
| `point_transactions` | `entry_date` | Data civil escolhida, sem deslocamento de fuso |
| `point_transactions` | `valuation_mode` | `total_value` para VT ou `per_thousand` para VM |
| `point_transactions` | `cash_total` | Valor total `numeric(16,2)`, não negativo |
| `point_transactions` | `cost_per_thousand` | Milheiro `numeric(14,4)`, não negativo |
| `point_transactions` | `operation_id` | Idempotência de reenvio, único quando preenchido |
| `expiration_lots` | `source_transaction_id` | Liga o lote à transação, único e com `on delete set null` |

O enum `point_entry_category` contém `initial_balance`, `points_purchase`, `transfer`, `credit_card` e `other`. Um índice parcial permite apenas um `initial_balance` por conta.

Na versão 0.3.0, o enum também contém `manual_exit`.

## RPCs administrativos de pontos

| Função | Responsabilidade |
| :--- | :--- |
| `get_admin_clients` | Lista paginada e pesquisável para qualquer integrante ativo da equipe |
| `get_admin_client_points_detail` | Detalhe sem contato pessoal, incluindo todos os programas ativos |
| `record_point_entry` | Cria conta quando necessário e grava transação, snapshot e lote atomicamente |
| `set_program_club_status` | Atualiza o clube por conta de programa |
| `add_expiration_lot` | Classifica vencimento sem alterar saldo e limita lotes ao saldo atual |

## RPCs administrativas da versão 0.3.0

| Função | Responsabilidade |
| :--- | :--- |
| `get_admin_overview` | Indicadores, papel e capacidades do operador |
| `get_admin_form_options` | Clientes ativos e contas com o último saldo oficial |
| `get_admin_clients` (4 argumentos) | Pesquisa, status, agregados e paginação |
| `archive_client` | Arquivamento lógico transacional para manager/super_admin |
| `record_travel_sale` / `get_travel_sales` | Viagens, economia e baixa explícita em milhas |
| `upsert_travel_interest` / `get_travel_interests` | Cadastro, atualização, busca e paginação de interesses |
| `get_points_ranking` | Ranking global antes da paginação, com vencimentos e programas |
| `confirm_transfer` | Transferência, três movimentos possíveis, snapshots e validade |
| `record_manual_exit` | Baixa idempotente, snapshot e consumo FIFO de lotes classificados |

Todas as mutações autenticadas exigem staff de escrita ativo. Até a versão 0.3.x também era exigido claim `aal2`; a partir da 0.4.0 o MFA deixa de ser obrigatório, mas a autorização por `staff_members` e papel continua no backend. Auditor possui apenas consultas.

As mutações são `security definer`, fixam `search_path`, usam `auth.uid()` e permitem execução somente a `authenticated`; a autorização efetiva é refeita internamente por `can_write_client_data()`.

## Economia

| Tabela | Uso |
| :--- | :--- |
| `redemptions` | Emissões, custos e economia |
| `redemption_point_usages` | Pontos utilizados por programa |

## Fórmulas no PostgreSQL

`card_statements.expected_points`, `card_statements.divergence`, `balance_snapshots.estimated_value`, `redemptions.effective_cost`, `redemptions.savings_amount` e `expiration_lots.remaining_points` são colunas calculadas pelo banco.

O frontend não determina esses valores oficiais.

O custo total e o custo médio de entradas também são recalculados no PostgreSQL com `numeric`. O patrimônio continua usando `loyalty_programs.default_value_per_thousand`, não o custo de aquisição.

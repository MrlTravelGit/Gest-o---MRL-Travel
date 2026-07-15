# Dicionário do banco de dados

## Identidade e acesso

| Tabela | Uso |
| :--- | :--- |
| `profiles` | Dados mínimos do usuário autenticado |
| `staff_members` | Função e status da equipe |
| `clients` | Cadastro principal e `public_id` |
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

## Economia

| Tabela | Uso |
| :--- | :--- |
| `redemptions` | Emissões, custos e economia |
| `redemption_point_usages` | Pontos utilizados por programa |

## Fórmulas no PostgreSQL

`card_statements.expected_points`, `card_statements.divergence`, `balance_snapshots.estimated_value`, `redemptions.effective_cost`, `redemptions.savings_amount` e `expiration_lots.remaining_points` são colunas calculadas pelo banco.

O frontend não determina esses valores oficiais.

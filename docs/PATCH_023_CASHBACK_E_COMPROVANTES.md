# PATCH 023 — Cashback por economia e comprovante opcional

## Arquitetura

- `redemptions` permanece como fonte oficial das economias e guarda a fotografia do percentual e valor calculado pelo backend.
- `cashback_transactions` é o ledger imutável de créditos, utilizações, estornos e ajustes.
- `cashback_transaction_allocations` associa utilizações aos créditos em ordem FIFO, permitindo bloquear correções de créditos já consumidos.
- `saving_evidence_files` guarda apenas metadados e caminhos internos. URLs assinadas nunca são persistidas.
- O bucket `savings-evidence` é privado, limitado a 10 MB e aceita somente PNG, JPEG e WebP.

## Segurança

- Configuração, cálculo e movimentações são executados por RPCs autenticadas e auditadas.
- A utilização bloqueia o cliente durante a transação, impedindo consumo concorrente do mesmo saldo.
- Créditos e estornos possuem chaves únicas e operações idempotentes.
- O upload usa URL assinada, valida tamanho, hash SHA-256 e assinatura binária real antes de ativar a referência.
- O painel público solicita uma URL de 120 segundos somente após o backend validar novamente o token e a propriedade da economia.
- Não há SELECT anônimo no ledger, metadados ou objetos do Storage.

## Compatibilidade

- Clientes existentes começam com cashback desabilitado.
- Economias anteriores mantêm percentual nulo e valor zero.
- Nenhum crédito retroativo é criado para as 68 linhas do PATCH 022.
- O lote de 3.080.020 pontos do PATCH 020 não é alterado nem reexecutado.

Migrations: `202607220027` e `202607220028`.

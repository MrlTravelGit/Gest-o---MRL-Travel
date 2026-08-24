# PATCH 024 — cashback sobre o valor pago

Data de referência: 23/07/2026  
Versão: 0.4.8  
Migration: `202607230029_cashback_paid_amount_v1.sql`

## Regra canônica

O backend calcula:

```text
cashback = round(valor_pago_canônico × percentual / 100, 2)
```

O cálculo usa `numeric` no PostgreSQL, arredonda somente o resultado final e persiste:

- `cashback_base_type = paid_amount`;
- `cashback_base_amount = effective_cost`;
- `cashback_calculation_version = paid_amount_v1`;
- percentual e valor oficial em `redemptions`;
- os mesmos dados no metadata do ledger.

O RPC não recebe `cashback_amount` do navegador. A prévia do frontend usa inteiros
escalados com `BigInt`; dinheiro e percentual são enviados aos RPCs como strings
decimais normalizadas.

## Fluxos corrigidos

- criação de economia em `record_travel_sale`;
- edição em `admin_update_travel_saving`;
- prévia de criação e edição;
- resumo anterior à confirmação;
- histórico administrativo;
- painel do cliente;
- cards, extrato e mensagens de confirmação;
- payloads administrativo e público;
- testes SQL e de componentes.

Alterar somente o valor original recalcula a economia, mas preserva o cashback. Alterar
o valor pago ou o percentual reconcilia o earning ainda não utilizado na mesma transação.

## Reconciliação

`admin_preview_cashback_paid_amount_reconciliation()` é somente leitura e inclui:

- créditos identificados explicitamente como `cashback-1.0.0`;
- bases anterior e correta;
- valores anterior, correto e diferença;
- valor já alocado/utilizado;
- ação recomendada;
- totais e invariantes legados.

`admin_apply_cashback_paid_amount_reconciliation(text)` exige a confirmação literal
`cashback_formula_reconciliation_paid_amount_v1`.

- Crédito sem utilização: estorno integral e novo earning.
- Crédito utilizado: ajuste líquido positivo ou negativo.
- Débito que deixaria o saldo negativo: linha em revisão, sem mutação financeira.
- Cada economia usa a chave externa
  `cashback_formula_reconciliation_paid_amount_v1:{saving_id}`.
- Reexecuções não criam novas movimentações.

Todas as correções são ligadas ao earning anterior, gravadas em
`cashback_formula_reconciliations` e registradas em `audit_logs`. Nenhum movimento é
apagado ou sobrescrito.

## Caso canônico

| Campo | Valor |
| :--- | ---: |
| Valor original | R$ 1.884,04 |
| Valor pago | R$ 1.706,90 |
| Economia | R$ 177,14 |
| Percentual | 2% |
| Resultado exato | R$ 34,138 |
| Cashback arredondado | R$ 34,14 |

## Segurança e preservação

- `dashboardv5.zip` não foi usado.
- Nenhum `db reset` faz parte do procedimento.
- Economias Iddas e registros sem percentual são excluídos da seleção.
- Pontos, contratos, links, clubes e comprovantes não são alterados pela migration.
- O saldo continua derivado exclusivamente de `cashback_transactions`.

## Validação

Validação local concluída:

- `npm run typecheck`;
- 27 arquivos e 102 testes Vitest;
- `npm run build`;
- `git diff --check`;
- varredura sem fórmula ativa de cashback baseada em economia fora das migrations
  históricas 027/028, que permanecem imutáveis.

Validação SQL e produção permanecem pendentes até a conta com acesso ao projeto
Supabase aplicar a migration. A CLI disponível retorna HTTP 403 e o Docker local não
está em execução; nenhum reset ou deploy parcial do frontend foi feito.

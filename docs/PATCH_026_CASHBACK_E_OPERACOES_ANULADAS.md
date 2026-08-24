# Patch 026 — cashback e operações anuladas

## Fonte de verdade

- Economia: `valor original - valor pago`.
- Cashback: `valor pago * percentual / 100`, arredondado para duas casas no backend.
- O frontend envia valores de entrada e percentual; nunca envia o cashback oficial.
- `redemptions` é a autoridade da operação comercial e `cashback_transactions` preserva o razão técnico.

## Anulação

A anulação é transacional, auditada e idempotente. Ela registra `voided_at`, `voided_by`, `void_reason` e `operation_group_id`, cria no máximo um estorno por crédito ativo e mantém todos os lançamentos vinculados como `admin_only`.

Antes da confirmação, `admin_preview_travel_saving_void` informa cashback gerado, utilizado, pago, alocado e disponível. Qualquer alocação bloqueia a anulação automática com `CASHBACK_REGULARIZATION_REQUIRED`.

## Painel público

`build_public_client_savings_history` inclui somente operações confirmadas. `build_public_client_cashback` não expõe o ledger técnico vinculado: para cada economia válida, produz uma única linha com o cashback final registrado em `redemptions`. Operações anuladas, seus créditos, estornos e ajustes ficam integralmente fora do payload público.

## Remediação

`admin_preview_voided_savings_repair` localiza registros legados pelo status e pelos vínculos de chave estrangeira. `admin_apply_voided_savings_repair('cashback_void_visibility_v1')` normaliza apenas candidatos sem cashback alocado. Não há busca textual nem alteração automática de operações válidas.

## Validação

- `supabase/tests/cashback_void_visibility_v1.sql`: 20 cenários específicos do Patch 026.
- Suíte SQL completa: 253 testes.
- Suíte Vitest: 102 testes.
- `admin_validate_patch026()` verifica fórmula, vazamentos públicos do ledger, grupos ausentes, estornos duplicados, candidatos legados e invariantes preservadas.

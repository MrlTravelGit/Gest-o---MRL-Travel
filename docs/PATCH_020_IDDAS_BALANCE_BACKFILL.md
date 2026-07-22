# PATCH 020 — saldos oficiais Iddas

Data de referência: 21/07/2026  
Chave do lote: `iddas_html_saldos_20260721_v1`

## Fonte e totais

O manifesto foi extraído do repositório atual e do arquivo `Iddas Milhas - Saldo.html`, SHA-256 `e53c31f3a46302566d207cf6c4842a272c837764769f4fb0c7360cf71ae208c1`. O arquivo `dashboardv5.zip` não foi usado.

O recorte autorizado contém exatamente 13 clientes, 44 contas, 3.080.020 pontos e R$ 60.189,72. A soma baseada apenas no custo por milheiro exibido seria R$ 60.187,90, pois esse campo está arredondado. Por isso o custo exibido é preservado no histórico e o valor contábil autoritativo da fonte é guardado separadamente no snapshot.

## Estruturas reutilizadas

- `import_batches`, `import_files`, `import_staging_rows` e `import_balance_reconciliations`: prévia e relatório do lote;
- `loyalty_programs` e `program_accounts`: catálogo e vínculos canônicos;
- `point_transactions`: ledger oficial, com categoria `initial_balance_import`;
- `balance_snapshots`: saldo, custo médio e patrimônio consumidos pelo admin e painel público; `source_book_value` é opcional e `estimated_value` mantém a fórmula anterior quando ele é nulo;
- `external_source_map` e `audit_logs`: rastreabilidade sem copiar dados pessoais para logs.

`iddas_balance_source_rows` é somente o manifesto imutável das 44 linhas autorizadas. RLS está habilitado e a tabela não possui grant para `anon` ou `authenticated`.

## Segurança e contabilidade

As RPCs de prévia, confirmação e rollback exigem `super_admin` ativo e revalidam os totais no servidor. O matching usa somente a correspondência explícita do patch e exige exatamente um cliente; não há fuzzy matching.

O commit é atômico por cliente, não cria pessoas, não altera `clients.status`, não soma saldos divergentes e usa `operation_id` determinístico. Reexecuções retornam replay idempotente com zero novos lançamentos. O rollback cria movimentos inversos e novos snapshots; não apaga histórico.

Patrimônio e economia permanecem conceitos distintos: o valor Iddas atualiza `estimated_value`, nunca `redemptions.savings_amount`.

## Verificação

Testes unitários cobrem pontos/moeda brasileiros, aliases canônicos, chave idempotente e ambiguidade. O teste SQL `supabase/tests/iddas_balance_backfill.sql` cobre conflito, atomicidade por cliente, status arquivado preservado, 44 operações únicas, totais exatos, igualdade admin/público e replay sem duplicação.

Comandos de validação:

```text
npm run typecheck
npm test
npm run build
npx supabase db reset --local
npx supabase test db --local
```

A validação de produção deve registrar a migration remota, a resposta das RPCs, os totais finais e o replay idempotente. Sem essas evidências o patch não deve ser declarado concluído.

## Recuperação corretiva de cadastro ausente

Na prévia remota, Leonardo Lima foi o único dos 13 aliases sem cadastro oficial: a linha existe no staging canônico do Notion, mas a própria validação registrou ausência de e-mail e telefone. A migration `202607210022_materialize_missing_iddas_legacy_client.sql` permite ao superadministrador recuperar exatamente esse vínculo como `lead`, com `legacy_contact_pending=true`, sem fabricar contato e sem ativar o cliente. A RPC exige a chave do lote, usa o Page ID exato do staging, bloqueia fontes ambíguas, grava `external_source_map` e `audit_logs` e é idempotente.

## Evidência de produção — 21/07/2026

- Projeto Supabase: `bdkazlhvnowjehdgxege`.
- Migration corretiva `202607210022_materialize_missing_iddas_legacy_client.sql` aplicada e registrada no histórico remoto.
- Deploy Vercel de produção: `dpl_5sMvzvWpM5F9LaAM88jmpjA6igev`, promovido para `https://gestao-mrltravel.vercel.app`.
- Lote remoto `iddas_html_saldos_20260721_v1` com status `committed`.
- Resultado exibido pela prévia remota: `13 / 13` clientes, `44 / 44` contas, `3.080.020` pontos e `R$ 60.189,72` de patrimônio.
- Resultado pós-commit: `0 para inserir · 44 já conciliadas · 0 conflitos · 0 não localizadas`.
- Reexecução remota: `Reexecução comprovada: 0 novo lançamento.`
- Cadastro administrativo: os 12 clientes preexistentes continuam `ARQUIVADO`; Leonardo Lima permanece `AGUARDANDO ATIVAÇÃO`, com `legacy_contact_pending`, 86.676 pontos e cinco programas.
- Conferência amostral do ledger/painel de Renata Martins Migotto: 84.387 pontos, dois programas, patrimônio de R$ 1.687,24 e duas entradas `Saldo inicial importado do Iddas` no histórico.
- Os 13 clientes não possuíam link público ativo no momento da validação. Nenhum novo link bearer foi criado apenas para o teste; a igualdade do payload administrativo/público permanece coberta pelos testes pgTAP e ambos consomem o mesmo ledger e os mesmos snapshots oficiais.

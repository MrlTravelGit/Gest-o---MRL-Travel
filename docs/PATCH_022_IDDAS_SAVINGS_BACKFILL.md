# PATCH 022 — Economias legadas Iddas

Implementação produtiva da importação auditável de `IDDAS_ECONOMIAS_LEGADO_20260722.csv`.

- Fonte canônica imutável: 68 linhas, 20 pessoas, R$ 251.347,13 originais, R$ 120.942,28 pagos e R$ 130.404,85 de economia.
- Destino oficial: `redemptions`, usando os campos financeiros e valores gerados já existentes.
- Idempotência: chave externa única, `operation_id` determinístico e hash imutável do payload de origem.
- Conciliação: ID legado comprovado, alias expressamente aprovado ou nome completo normalizado exato e único. Similaridade/fuzzy matching não é usada.
- Exceções e nomes não resolvidos permanecem em staging até seleção explícita de um superadministrador com justificativa.
- Edição e cancelamento são auditados e preservam os metadados de origem; exclusão é lógica.
- O histórico é consumido pelo cadastro administrativo e pelo dashboard público, cujo `client_id` continua derivado exclusivamente do token validado no backend.
- O lote de pontos do PATCH 020 permanece independente e não é reexecutado.

Migrations: `202607220024`, `202607220025` e `202607220026`. As duas últimas são correções incrementais de compatibilidade PostgreSQL; nenhuma migration aplicada foi reescrita remotamente.

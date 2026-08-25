# PATCH 032 — relatório de validação

Data: 25/08/2026

## Execuções concluídas

- Cofre local: `npm run typecheck` — aprovado.
- Cofre local: `npm test` — 6/6 aprovados. Abrange AES-GCM e detecção de adulteração, chave distinta por arquivo, bloqueio de MIME/arquivo vazio, allowlist de URL, aniversário em 29/02, reprocessamento idempotente e cinco credenciais padrão.
- Cofre local: `npm run build` — aprovado; frontend Vite e servidor TypeScript gerados separadamente.
- Painel principal: `npm run typecheck` — aprovado.
- Painel principal: teste focado `src/services/management-terms.test.ts` — 2/2 aprovados; normalização do Patch 028 e URL contendo somente `client_id`.
- Painel principal: `npm run build` — aprovado.
- Suíte principal completa: 130/131 testes funcionais aprovados. A única falha é preexistente em `notion-import-parser.test.ts`, pois o ZIP real do Notion não está presente; o resultado canônico recebido foi zero em vez da fixture esperada. O teste novo do Patch 032 foi aprovado nessa execução.
- `git diff --check` — aprovado, sem erro de whitespace.

## Banco e isolamento

Foi criado o teste pgTAP `supabase/tests/local_vault_outbox_and_management_terms_v1.sql`, cobrindo colunas mínimas, ausência de campos sensíveis, RLS, RPCs e negação anônima. Ele não foi executado nesta estação porque não há banco Supabase local/Docker disponível e a identidade atual não possui autorização para aplicar migrations remotamente. A migration permanece aditiva e não foi marcada como aplicada.

A inspeção estática confirmou que a outbox tem somente os oito campos autorizados. O agente local usa publishable key e token DPAPI de identidade exclusiva; não lê `service_role`. O cofre está em `.vercelignore`, tem package/build próprios e não é importado pelo painel principal.

## Evidência visual

O build de produção do cofre foi aberto em navegador real nas dimensões desktop e 390 × 844. A tela de login permaneceu legível, sem overflow, com MFA, indicação HTTPS/HttpOnly e identidade escura/dourada. A revisão encontrou um conflito de proxy somente no modo de desenvolvimento (`/api.ts`), corrigido restringindo o proxy a `/api/`; o build de produção já funcionava. A área autenticada depende da instalação DPAPI, certificado e primeiro administrador e deve receber a evidência final de homologação na estação Windows destinada ao serviço.

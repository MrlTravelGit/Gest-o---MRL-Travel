# PATCH 032 — relatório de validação

Data: 25/08/2026

## Execuções concluídas

- Cofre local: `npm run typecheck` — aprovado.
- Cofre local: `npm test` — 8/8 aprovados. Abrange criptografia e detecção de adulteração, chave distinta por arquivo, bloqueio de MIME/arquivo vazio, allowlist de URL, aniversário em 29/02, reprocessamento idempotente, cinco credenciais padrão, regra de senha com 15 caracteres e contrato de login somente com usuário e senha.
- Cofre local: `npm run build` — aprovado; frontend Vite e servidor TypeScript gerados separadamente.
- Painel principal: `npm run typecheck` — aprovado.
- Painel principal: teste focado `src/services/management-terms.test.ts` — 2/2 aprovados; normalização do Patch 028 e URL contendo somente `client_id`.
- Painel principal: `npm run build` — aprovado.
- Suíte principal completa: 136/137 testes funcionais aprovados. A única falha é preexistente em `notion-import-parser.test.ts`, pois o ZIP real do Notion não está presente; o resultado canônico recebido foi zero em vez da fixture esperada. O teste do Patch 032 foi aprovado nessa execução.
- `git diff --check` — aprovado, sem erro de whitespace.
- Busca pelos identificadores do mecanismo de autenticação removido — zero ocorrências no aplicativo, banco, CLI, testes e documentação operacional do Patch 032.

## Banco e isolamento

Foi criado o teste pgTAP `supabase/tests/local_vault_outbox_and_management_terms_v1.sql`, cobrindo colunas mínimas, ausência de campos sensíveis, RLS, RPCs e negação anônima. Ele não foi executado nesta estação porque não há banco Supabase local/Docker disponível e a identidade atual não possui autorização para aplicar migrations remotamente. A migration permanece aditiva e não foi marcada como aplicada.

A inspeção estática confirmou que a outbox tem somente os oito campos autorizados. O agente local usa publishable key e token DPAPI de identidade exclusiva; não lê `service_role`. O cofre está em `.vercelignore`, tem package/build próprios e não é importado pelo painel principal.

## Rede local

- O serviço exige endereço IPv4 privado ou loopback de desenvolvimento e rejeita bind público.
- O certificado inclui `localhost`, `127.0.0.1`, `mrl-vault.local` e o IPv4 privado informado.
- O instalador cria entrada TCP 7443 somente no perfil Private e somente para os endereços administrativos privados informados.
- A tarefa de backup e o serviço carregam o arquivo `.env` local.

## Evidência visual

O build de produção do cofre foi aberto em navegador real nas dimensões desktop (996 × 911) e móvel (390 × 844).

- Login com exatamente dois campos: usuário e senha.
- Logo oficial em `/assets/brand/logo-mrl-travel.svg`.
- Título “Acesso ao cofre local”, subtítulo “Dados protegidos da gestão” e identificação discreta “Ambiente local protegido”.
- Fundo preto neutro `rgb(5, 7, 9)` e família tipográfica `Poppins, Inter, ui-sans-serif, system-ui`, sem serifa.
- Sem overflow horizontal nos dois tamanhos.
- Em 390 × 844, o cartão mediu 350 px e permaneceu contido entre 20 px e 370 px, integralmente visível.

A área autenticada depende da instalação DPAPI, certificado e primeiro administrador e deve receber a evidência final de homologação na estação Windows destinada ao serviço.

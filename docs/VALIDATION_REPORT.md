# Relatório de validação

## Validação da versão 0.4.0 — 16/07/2026

| Verificação | Resultado real |
| :--- | :--- |
| Versão inicial confirmada | `0.3.2` em `package.json` antes do patch |
| Última migração confirmada | `202607160008_fix_get_admin_clients_rpc_ambiguity.sql` |
| PATCH MRL 002 | Implementado: `point_transactions`, `program_accounts`, `expiration_lots`, RPCs de pontos e testes existentes foram reutilizados |
| Sintaxe SQL do patch 004 | Aprovada com `pglast.parse_sql` para `202607160009_sidebar_clubs_invoices_history_access.sql` |
| TypeScript | `npm run typecheck` aprovado |
| Testes frontend/unitários | `npm test` aprovado: 13 arquivos, 37 testes |
| Build de produção | `npm run build` aprovado com Vite 8.1.4 |
| Supabase local | `npx supabase status` aprovado; serviços principais ativos |
| Migração local real | `npx supabase migration up --local` bloqueado antes dos patches 004/010 em `202607150003_storage_and_seed.sql`, no seed de `storage.buckets` do ambiente local |
| Ajuste definitivo de acesso | Aprovado em build: `/c/link/:token` navega para `/c/economia`, sem nome/código; `/admin/mfa` redireciona e não renderiza Authenticator |
| Sintaxe SQL do ajuste definitivo | Aprovada com `pglast.parse_sql` para `202607160010_client_economy_only_no_mfa.sql` |

### Lacuna de banco

Não foi executado `db reset` local nem qualquer comando destrutivo. Como o histórico local marca apenas 001 e 002 como aplicadas, `migration up --local` tentou aplicar 003 antes de 004/010 e falhou em estado prévio do storage local. Portanto, a versão 0.4.0 teve validação de sintaxe SQL e de contrato frontend/backend por build/testes, mas ainda precisa ser aplicada em homologação ou local limpo antes da produção.

### Arquivos críticos validados

1. Migrations aditivas: `supabase/migrations/202607160009_sidebar_clubs_invoices_history_access.sql` e `supabase/migrations/202607160010_client_economy_only_no_mfa.sql`.
2. Edge Function substituída no PATCH 005: `exchange-client-link` foi removida e deu lugar a `get-client-economy-by-link`.
3. Rotas administrativas: `/admin/clubes`, `/admin/faturas`, `/admin/movimentacoes`, `/admin/acessos` e `/admin/auditoria`.
4. Fluxo do cliente antigo: supersedido pelo PATCH 005; a rota pública atual é `/economia/:token` e também aceita `/c/link/:token` sem criar sessão.
5. Login admin: e-mail/senha com `staff_members` ativo; a rota antiga `/admin/mfa` redireciona e não renderiza Authenticator.
6. Validação pós-ajuste: `npm run typecheck`, `npm test`, `npm run build`, `git diff --check` e parse SQL das migrations 009/010 aprovados em 16/07/2026.

## Validação da versão 0.4.1 — PATCH 005, 16/07/2026

| Verificação | Resultado real |
| :--- | :--- |
| Fluxo `exchange-client-link` | Removido do frontend; função local antiga removida |
| Página “Validando link seguro” | Removida do bundle ativo |
| Sessão Supabase do cliente | Removida do fluxo público; `/economia/:token` consulta Edge Function pública |
| Edge Function pública | `supabase/functions/get-client-economy-by-link/index.ts` criada |
| Migration | `202607160011_client_economy_direct_link_path.sql` criada para novos links `/economia/{token}` e revogações de RPCs antigas |
| Admin sem MFA | `admin-create-client` não exige mais claim `aal2`; permanece validação de JWT e `staff_members` |
| TypeScript | `npm run typecheck` aprovado |
| Testes automatizados | `npm test` aprovado: 12 arquivos, 35 testes |
| Build de produção | `npm run build` aprovado |
| Diff check | `git diff --check` aprovado, apenas avisos CRLF do Windows |
| Migração local real | `npx supabase migration up --local` não conectou ao Postgres local (`LegacyDbConnectError`); não foi executado reset |

## Validação da versão 0.4.2 — PATCH 006, 17/07/2026

| Verificação | Resultado real |
| :--- | :--- |
| Causa da regressão | Confirmada: `/economia/:token` renderizava a página simplificada `Economia MRL Travel` e chamava `get-client-economy-by-link`, que retornava apenas economia |
| Contrato público | Substituído por `get-client-dashboard-by-link` + DTO `PublicClientDashboard` com saldos, patrimônio, economia, emissões, programas, custos, vencimentos e gráficos |
| Prévia administrativa | Substituída por `get_admin_client_dashboard_preview`, com o mesmo payload do link público |
| Migration | `202607160012_client_dashboard_direct_link_contract.sql` criada, sem editar migrações aplicadas |
| Sintaxe SQL | `pglast.parse_sql` aprovado para a migration 012 |
| TypeScript | `npm run typecheck` aprovado |
| Testes automatizados | `npm test` aprovado: 14 arquivos, 38 testes |
| Build de produção | `npm run build` aprovado com Vite 8.1.4; aviso esperado de chunk `charts` > 500 kB |
| Diff check | `git diff --check` aprovado, apenas avisos CRLF do Windows |
| Bundle ativo | Testes de regressão garantem ausência de `Economia MRL Travel`, `Somente economia` e `Página exclusiva de economia` no componente ativo; artefatos antigos ignorados em `dist` local não são parte do Git |
| Edge Function local | Deno não está instalado neste ambiente, portanto não houve typecheck Deno local |
| Migração local real | `npx supabase migration up --local` não conectou ao Postgres local (`LegacyDbConnectError`); não foi executado reset |

### Smoke test obrigatório após deploy 0.4.2

1. No admin, abra um cliente com dados conhecidos e anote `Total de pontos`, `Valor estimado`, `Programas ativos`, `Economia` e `Vencendo em 90 dias`.
2. Gere/rotacione o link em **Painel do cliente** e abra `/economia/{token}` em janela anônima.
3. Confirme que não aparece login, código, OTP, Authenticator ou “Validando link seguro”.
4. Confirme que o painel público mostra os mesmos totais do admin para o mesmo cliente e lista os mesmos programas ativos.
5. Teste um token inválido e confirme resposta genérica `Painel indisponível`.
6. Teste um link revogado/expirado e confirme que nenhum dado do cliente é exibido.

## Validação da versão 0.4.3 — PATCH 007, 17/07/2026

| Verificação | Resultado real |
| :--- | :--- |
| Origem do 401 | Confirmada no gateway Supabase: chamada remota sem `Authorization` retornou `401` com `UNAUTHORIZED_NO_AUTH_HEADER` e mensagem `Missing authorization header` |
| Exigência interna de usuário | Não encontrada: `get-client-dashboard-by-link` não chama `auth.getUser()` nem exige sessão/JWT de usuário |
| Algoritmo de token | Confirmado e preservado: geração SQL usa SHA-256 puro do token hex; Edge Function usa o mesmo hash via helper `client-link.ts`; `ACCESS_HASH_PEPPER` não é usado neste fluxo |
| Configuração local | `supabase/config.toml` agora possui `[functions.get-client-dashboard-by-link] verify_jwt = false`; funções administrativas não foram alteradas |
| Frontend | React Query do link público usa `retry: false` e query key sem token bruto |
| TypeScript | `npm run typecheck` aprovado |
| Testes automatizados | `npm test` aprovado: 15 arquivos, 41 testes |
| Build de produção | `npm run build` aprovado; aviso esperado de chunk `charts` > 500 kB |
| Diff check | `git diff --check` aprovado, apenas avisos CRLF do Windows |
| Deploy obrigatório | `npx supabase functions deploy get-client-dashboard-by-link --project-ref bdkazlhvnowjehdgxege --no-verify-jwt` executado com sucesso |
| Configuração remota | `npx supabase functions list --project-ref bdkazlhvnowjehdgxege` confirmou `get-client-dashboard-by-link verify_jwt:false` e `admin-create-client verify_jwt:true` |
| Smoke remoto pós-deploy | Token falso retornou `401` com corpo genérico `{"error":"Painel indisponível."}` e sem `sb-error-code` de gateway, comprovando que a função executou |

### Observação sobre link existente

Nenhum token real foi impresso ou usado nos testes. Como a geração e a verificação permanecem no mesmo algoritmo SHA-256 puro, links ativos gerados pelo mecanismo atual são preservados. Se um link específico continuar falhando após este deploy, a causa provável passa a ser link revogado/expirado, cliente/contrato inativo ou migração/payload ainda não aplicado no banco remoto.

## Validação da versão 0.4.4 — PATCH 008, 17/07/2026

| Verificação | Resultado real |
| :--- | :--- |
| Causa do chunk incorreto | Confirmada: `src/App.tsx` fazia lazy import de `@/pages/ClientEconomyPage` para `/economia/:token` |
| Rota pública | Alterada para `PublicClientDashboardPage`, preservando `/economia/:token` e aliases legados |
| View compartilhada | `ClientDashboardView` passa a renderizar o painel completo no link público e na prévia admin |
| Arquivo removido | `src/pages/ClientEconomyPage.tsx` removido do código ativo |
| Teste de rota | Adicionado teste para `/economia/:token` renderizar o dashboard completo sem validação intermediária |

### Verificação obrigatória de bundle

Após o build da versão 0.4.4, executar:

```bash
rg -n "ClientEconomyPage|Economia MRL Travel|Escopo da pagina" dist
```

O resultado esperado é zero ocorrência.

## Versão

| Campo | Valor |
| :--- | :--- |
| Projeto | Sistema de Gestão de Milhas MRL Travel |
| Versão | 0.2.0 |
| Data | 15/07/2026 |

## Verificações aprovadas

| Verificação | Resultado |
| :--- | :--- |
| TypeScript | Aprovado |
| Testes automatizados | 25 testes aprovados em 9 arquivos |
| Build de produção | Aprovado com Vite 8.1.4 |
| Divisão de bundles | Aprovada |
| Auditoria de dependências | 0 vulnerabilidades encontradas |
| Busca por chave administrativa no frontend | Nenhuma chave encontrada |
| CORS com origem universal | Não encontrado nas funções |
| Arquivos `.env` reais | Não incluídos |
| Project URL e Project Ref | Configurados |
| Publishable Key | Configurada e validada pelo schema do frontend |
| Endpoint remoto de Auth | HTTP 200 |
| Login remoto por e-mail | Habilitado |
| Cadastro público remoto | Habilitado, bloqueio necessário antes da produção |
| Preflight da função administrativa | HTTP 204 no domínio oficial da Vercel |
| Mensagens do cadastro de cliente | Respostas seguras do backend preservadas no frontend |
| Rejeição de variáveis fictícias | 3 testes adicionados |
| Cálculos VT, VM e custo médio | 7 testes aprovados |
| Formulário de pontos | Alternância VT/VM e quantidade inválida testadas |
| Clube por programa | Mutação e confirmação testadas |
| Migração nova | Arquivo aditivo `202607150004_admin_points_management.sql` criado |
| Testes pgTAP | 20 verificações escritas, não executadas por ausência de Docker/homologação |
| `db push --dry-run` | Executado; tentaria aplicar 001–004 porque o histórico remoto está vazio |
| Backups remotos | Nenhum backup listado e PITR desabilitado; publicação de banco bloqueada |

## Cobertura atual

1. Fórmula de pontos por real.
2. Fórmula de pontos por dólar.
3. Fórmula de economia gerada.
4. Validação estática do frontend.
5. Geração do bundle usado pela Vercel.
6. Cálculo VT e VM, arredondamento e custo médio ponderado.
7. Máscara monetária brasileira e rejeição de valores inválidos.
8. Bloqueio do formulário administrativo em Preview.
9. Validação do formulário de pontos e controle de clube.
10. Build das rotas `/admin/clientes` e `/admin/clientes/:clientId`.

## Validações que dependem do projeto Supabase

Os seguintes testes continuam pendentes em ambiente Supabase de homologação:

1. Aplicação da migração 004 em banco descartável ou homologação.
2. Execução das 20 verificações pgTAP em `supabase/tests/admin_points_management.sql`.
3. Concorrência real de dois lançamentos na mesma conta.
4. Rollback integral após falha intermediária.
5. Perfis `operator` e `auditor` com sessões reais.
6. Isolamento RLS entre dois clientes reais.
7. Lançamento de pontos e conferência no dashboard do cliente.
8. Auditoria com `actor_user_id` da sessão real.
9. Inspeção visual desktop e celular; o navegador integrado não estava disponível.

## Bloqueio de publicação atual

O projeto remoto está vinculado e contém as tabelas 001–003, mas a tabela de histórico de migrações não registra nenhuma delas. O `db push --dry-run --linked` tentaria reaplicar 001, 002, 003 e 004. Além disso, a consulta de backups retornou lista vazia e `pitr_enabled: false`.

Por segurança, a migração 004 e o frontend 0.2.0 não foram publicados. Antes da produção é obrigatório:

1. Criar backup ou habilitar ponto de recuperação.
2. Comparar o schema remoto com as migrações 001–003.
3. Reparar o histórico somente após essa comparação.
4. Executar a migração e os testes em homologação.
5. Aplicar 004 em produção e somente então publicar o frontend.

## Validação do PATCH 017 — 20/07/2026

Estado local: versão `0.4.4`, branch `main`, projeto Supabase vinculado
`bdkazlhvnowjehdgxege` e migration mais recente
`202607200016_notion_imports_and_management_tasks.sql`.

| Área | Causa comprovada | Correção e validação local |
| :--- | :--- | :--- |
| Gráficos públicos | O componente repassava valores e datas sem normalização robusta e dependia de dimensões/legenda frágeis do Recharts. | Adaptador canônico para saldo e movimentos, consolidação mensal, domínios para zero/um ponto, wrappers responsivos, eixos separados e empty state. |
| Logos dos programas | O registro usava `atomos.svg`, `azul-fidelidade.svg` e `livelo.svg`, mas os arquivos reais são `átomos.svg`, `azul.svg` e `logo-livelo.svg`. | Registro tipado único, aliases normalizados, componente com `img` e fallback somente em erro real. Todos os sete assets testados via HTTP 200 no preview. |
| Marca MRL | O dashboard renderizava o selo provisório em texto. O repositório não contém o PNG citado no patch; contém somente o asset oficial `public/assets/brand/logo-mrl-travel.svg`. | `BrandLogo` reutilizável no topo, rodapé, loading e erro, usando o SVG existente sem recriar a marca. A troca para PNG fica condicionada à inclusão do arquivo oficial. |
| Importador | O frontend dependia de uma Edge Function/schema ainda não comprovados no remoto; upload direto também não era adequado para ZIP de até 15 MB. | Upload assinado em bucket privado, checksum, magic bytes, limites de ZIP, staging/dry-run, claim atômico do lote, limpeza oportunista, CORS por allowlist e códigos estáveis. `verify_jwt=true` foi preservado. |
| Pop-up | `window.open()` bloqueado gerava exceção não capturada. | O handler retorna estado não destrutivo e oferece cópia do link sem lançar erro. |

Contrato canônico dos gráficos:

- `BalanceHistoryPoint { period, points, averageCost }`;
- `MonthlyMovementPoint { period, pointsIn, pointsOut, netPoints }`;
- compatibilidade com o payload legado fica concentrada em `dashboard-chart-data.ts`.

Validações executadas:

- `npm test`: 22 arquivos e 71 testes aprovados;
- parser do export real: 21 clientes, 41 demandas, 56 programas, 9 onboardings, 1 passagem, 28 relações vinculadas, 13 pendentes, 35 visões filtradas ignoradas e zero saldos oficiais criados;
- `npm run typecheck`: aprovado;
- `npm run build`: aprovado;
- `npx deno check --node-modules-dir=auto supabase/functions/admin-imports/index.ts`: aprovado;
- `git diff --check`: aprovado (somente avisos de conversão LF/CRLF no Windows);
- `dist`: um único chunk `ClientDashboardView`, zero referências a `ClientEconomyPage`, `/src/assets` ou nomes antigos de SVG;
- XML dos SVGs: todos válidos, com `viewBox` e sem referências locais quebradas.

### Produção pendente

Nenhum deploy foi feito. A conta Supabase disponível retorna HTTP 403 ao executar
`functions list` e `db lint --linked`, portanto não foi possível confirmar ou aplicar
schema, RLS, bucket, Edge Function, preflight e smoke tests no projeto remoto. A Vercel
também não foi publicada. O backend deve ser publicado e validado antes do frontend.

Leituras remotas não destrutivas confirmaram o estado atual:

- o domínio Vercel responde HTTP 200 e serve o chunk corrigido do dashboard;
- a logo MRL e os seis SVGs de programas respondem HTTP 200 em produção;
- o `OPTIONS` e o `POST` de `admin-imports` retornam HTTP 404 com
  `sb-error-code: NOT_FOUND` e `Requested function was not found`;
- portanto, o sintoma de CORS do importador em produção é consequência comprovada da
  ausência da Edge Function remota, não de `mode: cors` no frontend;
- o bundle publicado do importador difere do build local e não deve ser atualizado antes
  da migration e da função administrativa estarem prontas no Supabase.
## PATCH 019 — importação, saldos e reconciliação (20/07/2026)

- Adapter atualizado para `notion_mrl_v2`, com leitura das bases canônicas e descarte das visões filtradas.
- Correspondência de clientes: Page ID, CPF com hash e pepper, e-mail e telefone; nome é apenas indício manual.
- O dry-run não altera o ledger. O commit administrativo é atômico, idempotente, auditado e preserva RLS.
- Programas reconciliam saldo atual/importado e exigem justificativa para ajuste ou entrada adicional.
- Validades importadas geram lote somente quando há movimento positivo confirmado.
- Os gráficos continuam consumindo `point_transactions` e `balance_snapshots`, sem fonte paralela.
- Validação local obrigatória: `npm run typecheck`, `npm test`, `npm run build` e lint/reset do banco quando o Docker local estiver disponível.
- Publicação remota não é implícita: migration e Edge Function devem ser promovidas juntas em janela autorizada.

## Validação da versão 0.4.5 — PATCH 020, 21/07/2026

| Verificação | Resultado real |
| :--- | :--- |
| Fonte autorizada | `Iddas Milhas - Saldo.html`; `dashboardv5.zip` não foi usado |
| Causa do 12/13 inicial | Leonardo Lima existia no staging Notion, mas não havia sido materializado porque a fonte não possuía e-mail nem telefone válidos |
| Correção aditiva | Migration `202607210022_materialize_missing_iddas_legacy_client.sql`, sem editar migration aplicada e sem fabricar contato |
| Migration remota | Histórico local/remoto alinhado até `202607210022` no projeto `bdkazlhvnowjehdgxege` |
| Commit remoto | Lote `iddas_html_saldos_20260721_v1` com status `committed` |
| Totais remotos | 13/13 clientes, 44/44 contas, 3.080.020 pontos e R$ 60.189,72 |
| Idempotência remota | 0 para inserir, 44 já conciliadas e mensagem `Reexecução comprovada: 0 novo lançamento.` |
| Status | 12 cadastros preexistentes preservados como arquivados; Leonardo criado como lead aguardando ativação |
| Testes frontend | 24 arquivos e 81 testes aprovados |
| Testes SQL | 5 arquivos e 90 testes pgTAP aprovados após `db reset --local` |
| Build | `npm run build` aprovado |
| Produção Vercel | Deploy `dpl_5sMvzvWpM5F9LaAM88jmpjA6igev` pronto no alias oficial |

Nenhum dos 13 clientes possuía link bearer ativo durante a validação. Para não alterar acessos reais apenas para teste, não foi criado um novo link; o painel administrativo, os lançamentos e os snapshots remotos foram conferidos, e a igualdade entre o payload administrativo e o público é exercitada no teste SQL do backfill.

## Validação da versão 0.4.6 — PATCH 021, 21/07/2026

| Verificação local | Resultado real |
| :--- | :--- |
| Estado inicial | versão 0.4.5; migration remota mais recente 202607210022 |
| Schema | `client_status` usa `lead`, `active`, `paused`, `ended`; `ended` é o arquivamento existente |
| Reset completo | migration 023 aplicada após recriar o banco local desde zero |
| Testes SQL | 6 arquivos, 146 testes pgTAP aprovados; 56 são específicos do PATCH 021 |
| Testes frontend | 25 arquivos e 85 testes aprovados |
| TypeScript | aprovado |
| Build Vite | aprovado |
| Edge Functions | `admin-client-management` e `get-client-dashboard-by-link` aprovadas pelo Deno check |
| Ledger | testes confirmam pontos, programas, transações e links idênticos antes/depois |
| Idempotência | reativação repetida retorna `already_active` sem nova mutação |
| Segurança | tabelas privadas com RLS forçada; mutações administrativas sem escrita anônima/direta |

A causa do texto junto ao nome era o título do `LeadActivationBanner`, não uma regra de banco. O cabeçalho foi separado em nome, badge e texto de apoio. Casos persistidos em dados legados são tratados somente pela prévia revisável e reversível.

A importação do PATCH 020 preservou o estado dos registros conciliados; ela não executou arquivamento em massa. A reativação do PATCH 021 é deliberadamente seletiva e nunca inclui leads automaticamente.

### Estado remoto durante a preparação

- projeto confirmado: `bdkazlhvnowjehdgxege`;
- conta web confirmada como Owner da organização;
- migrations local/remoto alinhadas até 202607210022; migration 023 pendente antes do deploy;
- lint remoto aprovado, com dois avisos preexistentes fora do escopo;
- os endpoints privilegiados de `db push`, `link`, `secrets list` e deploy de função retornaram HTTP 403 mesmo após renovar o token CLI, enquanto `projects list`, `migration list`, `functions list` e `db lint` funcionaram.

O PATCH 021 só pode ser marcado como concluído quando a migration, funções e frontend estiverem publicados e os testes produtivos individual, em lote, contrato, auditoria, link, desktop e celular tiverem evidência real.

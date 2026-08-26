# PATCH MRL 034 — relatório de migration e validação

Data: 26/08/2026  
Projeto Supabase confirmado: `bdkazlhvnowjehdgxege` (`Gestão de Viagens - MRL Travel`)

## Auditoria anterior à alteração

- O vínculo local (`supabase/.temp/project-ref`, pooler e script `supabase:link`) aponta para `bdkazlhvnowjehdgxege`.
- O painel autenticado do Supabase confirmou o mesmo projeto.
- O histórico remoto terminava em `202608240036`; as migrations locais `202608250037` e `202608260038` eram as únicas pendentes.
- `pg_proc` não continha nenhuma função `public.get_client_management_terms_v1`, confirmando que a falha não era apenas visual: a RPC ainda não existia no remoto.
- O frontend envia 17 argumentos nomeados. A migration 037 local definia os mesmos nomes em ordem diferente da assinatura canônica exigida pelo Patch 034.

## Migration aplicada

- Nova migration: `202608260038_fix_client_management_terms_rpc_v1.sql`.
- A migration 037 não foi editada.
- As migrations pendentes 037 e 038 foram aplicadas juntas em uma única transação e registradas em `supabase_migrations.schema_migrations`.
- Não houve `db reset`, exclusão de tabela ou exclusão de dados.
- A 038 remove somente a assinatura antiga exata e cria uma única sobrecarga canônica.
- A transação terminou com `NOTIFY pgrst, 'reload schema'`.

Contrato remoto final:

- uma única sobrecarga;
- 17 parâmetros na ordem canônica;
- retorno `jsonb`;
- `STABLE`, `SECURITY DEFINER` e `search_path=pg_catalog, public`;
- `anon` sem `EXECUTE` e `authenticated` com `EXECUTE`;
- autorização interna por `auth.uid()` + `public.is_staff()`;
- limite normalizado entre 1 e 100, offset não negativo e allowlist de ordenação;
- verificação de contrato executada dentro da própria migration antes do commit.

## Validação remota

- Sessão administrativa real: RPC executada com um usuário ativo de `staff_members`; retornou 31 clientes e as chaves `summary`, `items`, `total`, `limit`, `offset` e `canVaultAccess`.
- Sessão não administrativa real: executada com um `client_user` ativo que não pertence a `staff_members`; bloqueada com SQLSTATE `42501`.
- Cache PostgREST: validado pela rota de produção autenticada, que passou a chamar a RPC sem `PGRST202` após o reload.
- Filtro remoto “Com cashback”: retornou recorte consistente, com total de cashback de R$ 84,14 e sem erro de cache.

### Reconciliação financeira independente

Foram selecionados os dois maiores valores de economia retornados pela RPC e recalculados diretamente a partir de `redemptions` confirmadas e do ledger `cashback_transactions`, limitados à vigência escolhida pela RPC.

| Cliente mascarado | Economia RPC | Economia manual | Cashback RPC | Cashback manual | Resultado |
|---|---:|---:|---:|---:|---|
| F*** | R$ 35.336,88 | R$ 35.336,88 | R$ 0,00 | R$ 0,00 | igualdade exata |
| R*** | R$ 25.075,81 | R$ 25.075,81 | R$ 0,00 | R$ 0,00 | igualdade exata |

## Validação visual de `/admin/vigencias`

Validação física realizada no Chrome com sessão real de superadministrador:

- rota carregada em `https://gestao-mrltravel.vercel.app/admin/vigencias`;
- título, breadcrumb, seis indicadores, filtros, tabela, valores financeiros, ações e paginação renderizados;
- 31 clientes no recorte sem filtros;
- indicadores observados: 8 ativas, 0 vencendo em 30 dias, 4 encerradas, 4 sem vigência, R$ 89.347,38 de economia e R$ 84,14 de cashback;
- aplicação do filtro “Com cashback” atualizou indicadores e registros sem erro e sem perder a rota;
- nenhuma mensagem técnica, erro de schema cache, sobreposição ou conteúdo quebrado foi observado no viewport desktop.

O comportamento móvel foi auditado no código responsivo: abaixo de 760 px a tabela é ocultada e os cartões `.management-term-cards` são exibidos; abaixo de 480 px indicadores e filtros passam a uma coluna. O controlador do Chrome disponível nesta execução não oferece emulação de viewport, portanto não foi possível registrar uma captura física em 390 px com a mesma sessão autenticada.

## Verificações locais

- `npm run typecheck`: aprovado.
- Teste específico de vigências: 5/5 aprovados.
- `npm run build`: aprovado.
- `git diff --check`: aprovado.
- Suíte completa: 123/124 testes aprovados. A única falha é externa ao Patch 034: `src/lib/notion-import-parser.test.ts` detecta um diretório temporário de fixture do Notion existente, porém vazio (0 arquivos `.csv`/`.md`), e por isso compara contagens zeradas. O ZIP esperado também não existe. Nenhum arquivo desse teste foi alterado.

## Escopo preservado

Os arquivos e serviços do Patch 033 do Cofre Local foram preservados. As diferenças já existentes em `.env.example`, `ProtectedDataButton.tsx`, `vitest.config.ts`, `apps/` e documentos do Patch 033 não foram produzidas nem modificadas pelo Patch 034.

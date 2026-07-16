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
| Migração local real | `npx supabase migration up --local` bloqueado antes do patch 004 em `202607150003_storage_and_seed.sql`, no seed de `storage.buckets` do ambiente local |

### Lacuna de banco

Não foi executado `db reset` local nem qualquer comando destrutivo. Como o histórico local marca apenas 001 e 002 como aplicadas, `migration up --local` tentou aplicar 003 antes de 004 e falhou em estado prévio do storage local. Portanto, a versão 0.4.0 teve validação de sintaxe SQL e de contrato frontend/backend por build/testes, mas ainda precisa ser aplicada em homologação ou local limpo antes da produção.

### Arquivos críticos validados

1. Migration aditiva: `supabase/migrations/202607160009_sidebar_clubs_invoices_history_access.sql`.
2. Edge Function nova: `supabase/functions/exchange-client-link/index.ts`.
3. Rotas administrativas: `/admin/clubes`, `/admin/faturas`, `/admin/movimentacoes`, `/admin/acessos` e `/admin/auditoria`.
4. Fluxo do cliente: `/c/link/:token` troca o token e navega para `/c/dashboard`.
5. Login admin: e-mail/senha com `staff_members` ativo, sem redirecionamento obrigatório para MFA.

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

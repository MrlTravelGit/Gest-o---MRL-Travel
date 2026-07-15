# Relatório de validação

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

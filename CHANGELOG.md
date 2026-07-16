# Histórico de versões

## 0.4.0, 16/07/2026

### Adicionado

1. Shell administrativo persistente com sidebar desktop, estado recolhido e drawer mobile, mantendo `/admin` como visão geral com o Hero atual.
2. Módulo funcional de Clubes em `/admin/clubes`, com catálogo versionado, benefícios, assinaturas de clientes e confirmação idempotente de créditos previstos.
3. Módulo funcional de Faturas em `/admin/faturas`, reutilizando `credit_cards`, `card_earning_rules` e `card_statements`, com cálculo oficial no backend e snapshot da regra/cotação.
4. Histórico unificado em `/admin/movimentacoes`, baseado em `point_transactions`, com filtros, paginação e estorno auditável sem `DELETE` físico.
5. Gestão de links diretos em `/admin/acessos` e `/admin/auditoria`, com token bearer de 256 bits, hash no banco, revogação, expiração, rate limit e eventos minimizados.
6. Edge Function `exchange-client-link` para trocar link secreto por sessão Supabase e limpar a URL do cliente após a troca.
7. Página pública `/c/economia`, dedicada exclusivamente à economia do cliente autenticado pelo link bearer.
8. Prévia administrativa `/admin/clientes/:clientId/economia` e ações no detalhe do cliente para abrir, gerar/rotacionar e copiar o link recém-gerado.

### Alterado

1. Login administrativo passa a exigir e-mail/senha individual e `staff_members` ativo, sem página ou exigência de Authenticator/MFA no aplicativo.
2. `can_write_client_data()` e `can_manage_security()` deixam de exigir AAL2, preservando autorização por papel no backend.
3. O fluxo legado do cliente por `public_id`, primeiro nome e código temporário saiu das rotas ativas; links antigos não renderizam mais o formulário antigo.
4. Versão do pacote atualizada de `0.3.2` para `0.4.0`.

### Segurança e integridade

1. Novas tabelas nascem com RLS forçada, grants mínimos e mutações por RPC `security definer` com `search_path` fixo.
2. O catálogo inicial de clubes foi versionado como dado editável; informações ambíguas/promocionais são marcadas para revisão humana.
3. Links diretos são tratados explicitamente como credenciais bearer: quem possui o link pode entrar até expirar/revogar.
4. Nenhum número completo de cartão, CVV, senha bancária, token bruto ou segredo foi adicionado ao frontend.
5. A migration `202607160010_client_economy_only_no_mfa.sql` cria RPCs estreitas para economia e revoga o contrato direto do dashboard antigo por `public_id`.

## 0.3.2, 16/07/2026

### Corrigido

1. Removidos os overloads conflitantes de `get_admin_clients` que causavam `PGRST203` no PostgREST.
2. Estabelecida assinatura canônica única `get_admin_clients(p_limit, p_offset, p_search, p_status)` com `p_status = 'all'`.
3. Frontend, testes unitários e pgTAP passam a usar apenas o contrato oficial, sem fallback para assinaturas antigas.

## 0.3.1, 16/07/2026

### Corrigido

1. Adicionada assinatura compativel de `get_admin_clients(p_limit, p_offset, p_search, p_status)` para resolver o erro `PGRST202` do painel administrativo em producao.
2. O frontend passa a enviar os parametros no contrato observado pelo PostgREST e faz fallback seguro para a RPC antiga de 3 argumentos quando nao houver filtro de status.
3. Testes cobrem o contrato frontend e a assinatura pgTAP com busca e status.

## 0.3.0, 16/07/2026

### Adicionado

1. Home administrativa premium com Hero, Aurora dourada, quatro indicadores oficiais e Bento Grid com oito módulos.
2. Rotas lazy-loaded de Clientes, Cadastro de Pessoas, Viagens/Economia, Pontuações, Formulários, Interesses, Transferências e Saída Manual.
3. Cadastro de cliente com nascimento, endereço normalizado, observação e contrato no bundle PostgreSQL existente.
4. Ranking server-side, interesses paginados e viagens/economia sobre a fonte oficial `redemptions`.
5. Transferência e saída manual atômicas e idempotentes sobre o ledger do PATCH 002.
6. Formulários administrativos com React Hook Form, Zod, máscaras `pt-BR`, estados de carregamento/erro/vazio e interface responsiva.
7. Migrações `202607160005_manual_exit_category.sql` e `202607160006_admin_hero_bento_modules.sql`, com teste pgTAP direcionado.

### Segurança e integridade

1. Mutações administrativas passam a exigir AAL2 também no banco; cadastro via Edge Function valida o claim após validar o token no Auth.
2. Novas tabelas usam RLS forçada, grants mínimos, auditoria e funções `security definer` com `search_path` fixo.
3. Arquivamento lógico revoga vínculos e acesso sem apagar histórico ou usuário Auth.
4. Auditoria de clientes e endereços elimina PII dos snapshots de log.
5. Transferências, viagens em milhas e saídas bloqueiam a conta, conferem pertencimento e atualizam movimentos/snapshots numa transação.

### Alterado

1. `transfers` e `redemptions` foram evoluídas aditivamente; nenhuma estrutura paralela de saldos, transferências ou economia foi criada.
2. Versão do sistema atualizada para `0.3.0` e lógica oficial para `1.3.0`.

## 0.2.0, 15/07/2026

### Adicionado

1. Rotas administrativas `/admin/clientes` e `/admin/clientes/:clientId`.
2. Pesquisa e paginação de clientes com totais, clubes e vencimentos.
3. Detalhe com cards de todos os programas ativos, saldo, custo médio e valor estimado.
4. Lançamentos Saldo Inicial, Compra, Transferência, Cartão e Outros, com modos VT e VM.
5. Clube ativo por conta de programa e cadastro manual de vencimentos.
6. Histórico imutável de lançamentos e lotes ativos.
7. Migração `202607150004_admin_points_management.sql` e testes pgTAP correspondentes.

### Segurança e integridade

1. RPCs transacionais recalculam valores com `numeric`, bloqueiam a conta e validam `auth.uid()` e perfil.
2. Auditor permanece somente leitura; operador ativo pode lançar.
3. Saldo inicial possui unicidade por conta e lançamentos possuem chave idempotente.
4. Lote de validade vinculado, snapshot e transação são gravados atomicamente.
5. Nenhuma RLS foi removida ou relaxada.

### Interface

1. Experiência responsiva em carvão e dourado, com estados de carregamento, erro, sucesso e somente leitura.
2. Máscara BRL e cálculos instantâneos são apenas auxiliares; o PostgreSQL continua sendo a autoridade.

## 0.1.4, 15/07/2026

### Corrigido

1. A origem canônica passou a ser `https://gestao-mrltravel.vercel.app`, confirmada como alias de Production com HTTP 200.
2. Preflight permitido retorna HTTP 204 e ecoa somente a origem exata autorizada.
3. Preflight negado retorna HTTP 403 sem substituir a origem por outro domínio configurado.
4. O painel administrativo bloqueia cadastro em Preview e oferece link para o ambiente oficial.
5. Links de clientes usam a origem canônica configurada em `APP_URL`.

### Configurado

1. `VITE_APP_URL` em Production e Preview aponta para a origem canônica.
2. `APP_URL`, `ALLOWED_ORIGINS`, Site URL e Redirect URL de produção usam a mesma origem.
3. `localhost` permanece apenas como Redirect URL e origem de desenvolvimento local.

### Segurança

1. Nenhum wildcard de CORS ou autorização genérica de subdomínios Vercel foi adicionado.
2. MFA TOTP, autorização por `staff_members` e RLS permanecem ativos.
3. Nenhuma chave secreta, token ou dado de cliente foi registrado no patch.

### Banco de dados

Nenhuma migração foi criada ou alterada neste patch.

## 0.1.3, 15/07/2026

### Corrigido

1. O frontend deixou de substituir toda falha de cadastro por uma mensagem genérica.
2. Respostas seguras da Edge Function agora são apresentadas ao administrador.
3. Falhas de rede ou CORS orientam o uso do endereço oficial da Vercel.
4. E-mail ou telefone já associado a outro usuário recebe explicação específica.

### Segurança

1. Detalhes internos e dados sensíveis do Supabase continuam fora das mensagens.
2. O backend registra somente o código técnico do erro de Auth, sem registrar o contato do cliente.
3. Nenhuma política RLS ou permissão foi ampliada.

### Banco de dados

Nenhuma migração foi criada ou alterada neste patch.

## 0.1.2, 15/07/2026

### Configurado

1. Publishable Key do projeto Supabase no ambiente local.
2. Publishable Key no modelo de variáveis usado pelo frontend e pela Vercel.
3. Documentação de implantação atualizada.

### Segurança

1. A chave configurada possui privilégio público e permanece protegida pelas políticas RLS.
2. Nenhuma Secret Key, `service_role`, senha do banco ou token administrativo foi adicionada.
3. O arquivo local de ambiente continua ignorado no pacote e no controle de versão.
4. A inspeção remota identificou cadastro público habilitado, registrado como bloqueio de produção.

### Pendente

1. Autenticar a CLI no projeto Supabase.
2. Aplicar as migrações e publicar as Edge Functions.
3. Configurar as variáveis públicas no painel da Vercel.

### Banco de dados

Nenhuma migração foi criada ou alterada neste patch.

## 0.1.1, 15/07/2026

### Configurado

1. Project URL `https://bdkazlhvnowjehdgxege.supabase.co`.
2. Project Ref `bdkazlhvnowjehdgxege` no comando de vínculo.
3. Identificador local do projeto no arquivo de configuração do Supabase.

### Segurança

1. Validação explícita do prefixo `sb_publishable_`.
2. Rejeição de valores fictícios nas variáveis públicas.
3. Nenhuma chave secreta adicionada ao frontend ou à documentação.

### Pendente

1. Informar a Publishable Key no ambiente local e na Vercel.
2. Autenticar a CLI para aplicar migrações e publicar Edge Functions.

### Banco de dados

Nenhuma migração foi criada ou alterada neste patch.

## 0.1.0, 15/07/2026

Versão inicial da base funcional, banco PostgreSQL, RLS, Edge Functions, frontend, documentação e testes de fórmulas.

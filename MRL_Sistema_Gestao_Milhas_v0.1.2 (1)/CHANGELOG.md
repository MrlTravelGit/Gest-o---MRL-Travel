# Histórico de versões

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

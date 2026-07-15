# Preparação do Supabase

## Projeto de destino

| Campo | Valor |
| :--- | :--- |
| Project Ref | `bdkazlhvnowjehdgxege` |
| Project URL | `https://bdkazlhvnowjehdgxege.supabase.co` |
| Publishable Key | Configurada para o frontend |

## 1. Criar o projeto

Crie um projeto Supabase separado para o Sistema de Gestão de Milhas. Não reutilize o banco do dashboard corporativo existente.

O projeto já foi criado e a Publishable Key está configurada. Registre em local seguro:

1. Senha do PostgreSQL.
2. Credencial administrativa usada para publicações pela CLI.

A chave secreta ou `service_role` deve permanecer somente no Supabase e em ambientes administrativos controlados.

## 2. Vincular o projeto local

```bash
npx supabase login
npm run supabase:link
```

O comando de vínculo já está limitado ao Project Ref `bdkazlhvnowjehdgxege`.

## 3. Aplicar as migrações

```bash
npx supabase db push
```

As migrações devem ser executadas na ordem natural dos arquivos:

1. `202607150001_initial_schema.sql`
2. `202607150002_security_and_api.sql`
3. `202607150003_storage_and_seed.sql`

Nunca edite uma migração que já foi aplicada em produção. Crie um novo arquivo com timestamp posterior.

## 4. Configurar autenticação

### Estado remoto verificado em 15/07/2026

| Configuração | Estado |
| :--- | :--- |
| Endpoint de Auth | Respondendo com HTTP 200 |
| Login por e-mail | Habilitado |
| Login por telefone | Desabilitado |
| Confirmação automática de e-mail | Desabilitada |
| Cadastro público | Habilitado, deve ser desativado antes da produção |

No painel do Supabase:

1. Acesse Authentication.
2. Desative cadastro público de usuários.
3. Habilite e-mail com código temporário.
4. Configure SMTP próprio para produção.
5. Caso utilize SMS, configure um provedor compatível.
6. Configure a URL principal como `https://gestao.mrltravel.com`.
7. Adicione URLs de redirecionamento somente dos ambientes oficiais.
8. Revise a validade do código temporário.
9. Configure limites de autenticação e proteção contra abuso.

O MVP usa e-mail ou SMS. Um envio pelo WhatsApp poderá ser incorporado posteriormente por meio da API oficial, sem alterar o vínculo de usuário e as políticas RLS.

## 5. Criar o primeiro administrador

Crie o usuário administrativo em Authentication e copie seu UUID.

Depois execute no SQL Editor:

```sql
insert into public.staff_members (user_id, role, active)
values ('UUID_DO_USUARIO', 'super_admin', true);
```

O trigger de autenticação cria o registro correspondente em `profiles`. No primeiro login administrativo, o sistema exigirá o cadastro do autenticador TOTP.

## 6. Configurar segredos das funções

```bash
npx supabase secrets set APP_URL=https://gestao.mrltravel.com
npx supabase secrets set ALLOWED_ORIGINS=https://gestao.mrltravel.com
npx supabase secrets set ACCESS_HASH_PEPPER=SEGREDO_LONGO_ALEATORIO
```

Para desenvolvimento, copie `supabase/functions/.env.example` para um arquivo local ignorado pelo Git.

## 7. Publicar as funções

```bash
npx supabase functions deploy request-client-access
npx supabase functions deploy verify-client-access
npx supabase functions deploy admin-create-client
```

As funções de solicitação e confirmação do código são públicas apenas porque o cliente ainda não possui sessão. Elas aplicam CORS restrito, resposta genérica, expiração e limite de tentativas.

`admin-create-client` exige JWT válido e função administrativa no banco.

## 8. Gerar tipos após a publicação

```bash
npx supabase gen types typescript --linked > src/types/database.generated.ts
```

Depois conecte o tipo gerado ao `createClient` em `src/lib/supabase.ts`.

## 9. Teste mínimo de isolamento

1. Cadastre dois clientes.
2. Entre como o primeiro cliente.
3. Confirme que o RPC retorna somente o primeiro cadastro.
4. Tente usar o `public_id` do segundo cliente com a sessão do primeiro.
5. O banco deve responder com acesso não autorizado.
6. Repita o teste nas tabelas de programas, cartões, faturas, emissões e anexos.

## 10. Backup

Antes de cada publicação de banco:

1. Confirme que existe backup recente.
2. Teste a migração em ambiente separado.
3. Registre a versão aplicada.
4. Preserve procedimento de reversão quando a migração não for apenas aditiva.

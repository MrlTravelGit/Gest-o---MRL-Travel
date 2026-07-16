# Sistema de Gestão de Milhas MRL Travel

Versão atual: `0.3.0`.

Base funcional do novo sistema de gestão de pontos, cartões, programas de fidelidade, emissões, economia e vencimentos da MRL Travel.

## Estado desta entrega

Esta versão contém:

1. Estrutura PostgreSQL completa em migrações.
2. RLS e funções de autorização.
3. Funções agregadas para dashboard do cliente e painel administrativo.
4. Login do cliente por link, primeiro nome e código temporário.
5. Cadastro administrativo de cliente com geração do link exclusivo.
6. MFA TOTP obrigatório para o painel administrativo.
7. Storage privado para documentos.
8. Frontend React preparado para Vercel.
9. Testes das fórmulas centrais.
10. Lista e detalhe administrativo de clientes em `/admin/clientes`.
11. Lançamento transacional de pontos com VT/VM, custo médio e idempotência.
12. Clube por programa, vencimentos manuais e histórico imutável.

## Projeto Supabase definido

| Campo | Valor |
| :--- | :--- |
| Project Ref | `bdkazlhvnowjehdgxege` |
| Project URL | `https://bdkazlhvnowjehdgxege.supabase.co` |
| Publishable Key | Configurada no frontend local |

## Tecnologias

1. React 18 e TypeScript.
2. Vite.
3. Supabase Auth, PostgreSQL, Edge Functions e Storage.
4. TanStack Query.
5. Recharts.
6. Vercel.

## Início local

```bash
npm install
cp .env.example .env.local
npm run dev
```

Preencha `.env.local` apenas com valores públicos:

```text
VITE_SUPABASE_URL=https://bdkazlhvnowjehdgxege.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_zdeyRn9uv4RdcaTKokRxcg_x8C0vi_N
VITE_APP_URL=http://localhost:5173
```

Nunca coloque a chave secreta ou `service_role` em variável iniciada por `VITE_`.

## Supabase

```bash
npx supabase login
npm run supabase:link
npx supabase db push
npx supabase functions deploy request-client-access
npx supabase functions deploy verify-client-access
npx supabase functions deploy admin-create-client
```

Configure os segredos das Edge Functions:

```bash
npx supabase secrets set APP_URL=https://gestao-mrltravel.vercel.app
npx supabase secrets set ALLOWED_ORIGINS=https://gestao-mrltravel.vercel.app
npx supabase secrets set ACCESS_HASH_PEPPER=SEGREDO_LONGO_ALEATORIO
```

As variáveis `SUPABASE_URL`, `SUPABASE_ANON_KEY` e `SUPABASE_SERVICE_ROLE_KEY` são disponibilizadas pelo ambiente hospedado das Edge Functions. A chave administrativa nunca é enviada ao navegador.

## Validação

```bash
npm run typecheck
npm test
npm run build
```

## Documentação

1. [Lógica oficial](docs/PROJECT_LOGIC.md)
2. [Preparação do Supabase](docs/SUPABASE_SETUP.md)
3. [Implantação na Vercel](docs/VERCEL_DEPLOY.md)
4. [Arquitetura e segurança](docs/ARCHITECTURE_SECURITY.md)
5. [Dicionário do banco](docs/DATABASE_DICTIONARY.md)
6. [Protocolo de patches](docs/PATCH_PROTOCOL.md)
7. [Relatório de validação](docs/VALIDATION_REPORT.md)
8. [Histórico de versões](CHANGELOG.md)

# Implantação na Vercel

## 1. Criar o projeto

Importe o repositório do frontend na Vercel e mantenha o diretório raiz apontando para este projeto.

Configuração esperada:

| Campo | Valor |
| :--- | :--- |
| Framework | Vite |
| Comando de instalação | `npm install` |
| Comando de build | `npm run build` |
| Diretório de saída | `dist` |

O arquivo `vercel.json` já contém a reescrita necessária para rotas da SPA e cabeçalhos básicos de segurança.

## 2. Variáveis públicas

Cadastre as variáveis públicas. Em Production, `VITE_APP_URL` deve ser exatamente a origem canônica abaixo. Em Preview, mantenha o mesmo valor para que o painel identifique o Preview e ofereça o link correto para Production:

```text
VITE_SUPABASE_URL=https://bdkazlhvnowjehdgxege.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_zdeyRn9uv4RdcaTKokRxcg_x8C0vi_N
VITE_APP_URL=https://gestao-mrltravel.vercel.app
```

Nunca cadastre `SUPABASE_SERVICE_ROLE_KEY` com prefixo `VITE_`.

A Publishable Key pode ficar no frontend. Ela não substitui autenticação nem RLS. Não use `sb_secret_` ou `service_role` neste campo.

## 3. Domínio

O alias estável marcado como Production no projeto `gestao-mrl-travel` é `https://gestao-mrltravel.vercel.app`. Ele foi confirmado com HTTP 200 em 15/07/2026.

1. Não use URLs de deployment com hash nem aliases `git-*` como URL canônica.
2. Não autorize todos os subdomínios `vercel.app`.
3. Se um domínio personalizado for adicionado no futuro, valide HTTP 200 antes de trocar a origem canônica em todos os serviços.
4. Atualize `APP_URL` e `ALLOWED_ORIGINS` nos segredos do Supabase sempre que a origem canônica mudar.
5. Atualize Site URL e Redirect URLs no Supabase Auth na mesma publicação.

## 4. Ordem da publicação

1. Confirmar que `https://gestao-mrltravel.vercel.app/` responde HTTP 200.
2. Configurar `VITE_APP_URL` em Production e Preview.
3. Configurar `APP_URL`, `ALLOWED_ORIGINS`, Site URL e Redirect URLs no Supabase.
4. Publicar as três Edge Functions.
5. Publicar o frontend em Production.
6. Validar preflight permitido e negado.
7. Entrar no domínio oficial com MFA e criar um cliente com contato exclusivo.
8. Confirmar que o link gerado usa a origem canônica.

## 5. Ambientes

Recomenda-se manter:

1. Desenvolvimento local.
2. Homologação separada.
3. Produção.

O banco de produção não deve ser usado como ambiente de teste.

## 6. Verificações posteriores

1. A rota `/c/{public_id}` abre diretamente após atualização do navegador.
2. A rota `/admin` redireciona para login quando não há sessão.
3. A equipe só entra após MFA.
4. Chaves secretas não aparecem nos arquivos publicados.
5. O navegador não consegue consultar registros de outro cliente.
6. As Edge Functions rejeitam origens desconhecidas.

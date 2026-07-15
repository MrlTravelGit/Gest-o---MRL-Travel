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

Cadastre nos ambientes Production, Preview e Development conforme necessário:

```text
VITE_SUPABASE_URL=https://bdkazlhvnowjehdgxege.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_zdeyRn9uv4RdcaTKokRxcg_x8C0vi_N
VITE_APP_URL=https://gestao.mrltravel.com
```

Nunca cadastre `SUPABASE_SERVICE_ROLE_KEY` com prefixo `VITE_`.

A Publishable Key pode ficar no frontend. Ela não substitui autenticação nem RLS. Não use `sb_secret_` ou `service_role` neste campo.

## 3. Domínio

1. Adicione `gestao.mrltravel.com` ao projeto da Vercel.
2. Configure o registro DNS indicado pela Vercel.
3. Aguarde a emissão do certificado HTTPS.
4. Atualize `APP_URL` e `ALLOWED_ORIGINS` nos segredos do Supabase.
5. Atualize Site URL e Redirect URLs no Supabase Auth.

## 4. Ordem da publicação

1. Criar projeto Supabase.
2. Aplicar migrações.
3. Configurar Auth e SMTP ou SMS.
4. Cadastrar primeiro administrador.
5. Configurar segredos das Edge Functions.
6. Publicar Edge Functions.
7. Configurar variáveis da Vercel.
8. Publicar frontend.
9. Configurar domínio.
10. Executar teste de isolamento com dois clientes.

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

# Integração com a Autentique

## Configuração

Configure os secrets somente no Supabase:

```bash
supabase secrets set AUTENTIQUE_API_TOKEN=... AUTENTIQUE_SANDBOX=true AUTENTIQUE_WEBHOOK_SECRET=...
```

Os secrets opcionais são `AUTENTIQUE_ORGANIZATION_ID`, `AUTENTIQUE_FOLDER_ID` e `AUTENTIQUE_MAX_FILE_BYTES`. O limite padrão é 5 MiB; para uma conta profissional, configure `20971520` somente após confirmar o limite contratado.

Depois, aplique a migration e publique as funções:

```bash
supabase db push
supabase functions deploy send-contract-to-autentique
supabase functions deploy sync-autentique-document
supabase functions deploy autentique-webhook --no-verify-jwt
```

## Webhook

Cadastre no painel da Autentique:

```text
https://<project-ref>.supabase.co/functions/v1/autentique-webhook
```

Use formato JSON e selecione `document.created`, `document.updated`, `document.finished`, `signature.viewed`, `signature.accepted`, `signature.rejected` e `signature.delivery_failed`. Salve no secret `AUTENTIQUE_WEBHOOK_SECRET` o segredo retornado ao criar o endpoint. A função valida `x-autentique-signature` com HMAC SHA-256 e ignora eventos duplicados pelo ID.

Comece obrigatoriamente com `AUTENTIQUE_SANDBOX=true`. Antes de produção, altere o secret para `false`; o modal exige que o ambiente escolhido corresponda ao ambiente configurado no backend.

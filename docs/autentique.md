# Integração com a Autentique

## Configuração

Configure os secrets somente no Supabase:

```bash
supabase secrets set AUTENTIQUE_API_TOKEN=... AUTENTIQUE_SANDBOX=true AUTENTIQUE_WEBHOOK_SECRET=...
```

Configure também as testemunhas e a cota mensal:

```powershell
npx supabase secrets set AUTENTIQUE_MONTHLY_FREE_LIMIT="20"
npx supabase secrets set AUTENTIQUE_CONTRACTOR_SIGNER='{"name":"Michael","email":"mick_felipebh@hotmail.com"}'
npx supabase secrets set AUTENTIQUE_DEFAULT_WITNESSES='[{"name":"Gabriel","email":"gabrielhrmendes05@gmail.com"},{"name":"Camilla","email":"camillafelisbino1@gmail.com"}]'
```

O signatário da contratada é acrescentado com o papel `SIGN`; as testemunhas são acrescentadas com `SIGN_AS_A_WITNESS`. O backend elimina duplicidades por nome ou e-mail e salva os papéis `client_signer`, `contractor_signer` e `witness` no snapshot de signatários. Sem um `AUTENTIQUE_CONTRACTOR_SIGNER` válido o envio é bloqueado; a ausência de testemunhas gera um alerta no painel. Os secrets opcionais são `AUTENTIQUE_ORGANIZATION_ID`, `AUTENTIQUE_FOLDER_ID` e `AUTENTIQUE_MAX_FILE_BYTES`. O limite padrão de arquivo é 5 MiB; configure `20971520` somente após confirmar o plano contratado.

Para envio automático da confirmação ao cliente, configure `CUSTOMER_WHATSAPP_WEBHOOK_URL` e `CUSTOMER_WHATSAPP_WEBHOOK_SECRET`. Sem esse canal, o sistema cria uma notificação pendente para tratamento manual e não derruba o webhook.

Depois, aplique a migration e publique as funções:

```bash
supabase db push
supabase functions deploy send-contract-to-autentique
supabase functions deploy sync-autentique-document
supabase functions deploy get-autentique-send-context
supabase functions deploy resend-contract-approved-message
supabase functions deploy autentique-webhook --no-verify-jwt
```

## Webhook

Cadastre no painel da Autentique:

```text
https://<project-ref>.supabase.co/functions/v1/autentique-webhook
```

Use formato JSON e selecione `document.created`, `document.updated`, `document.finished`, `signature.viewed`, `signature.accepted`, `signature.rejected` e `signature.delivery_failed`. Salve no secret `AUTENTIQUE_WEBHOOK_SECRET` o segredo retornado ao criar o endpoint. A função valida `x-autentique-signature` com HMAC SHA-256 e ignora eventos duplicados pelo ID.

O evento `document.finished` é o único que preenche `approved_at` e dispara a mensagem ao cliente. Eventos `signature.accepted`, `signature.rejected` e `signature.delivery_failed` atualizam cada participante e nunca rebaixam um contrato já aprovado.

Comece obrigatoriamente com `AUTENTIQUE_SANDBOX=true`. Antes de produção, altere o secret para `false`; o modal exige que o ambiente escolhido corresponda ao ambiente configurado no backend. Sandbox não entra na cota. Em produção, a reserva mensal é serializada no banco; somente `super_admin` pode confirmar override acima do limite.

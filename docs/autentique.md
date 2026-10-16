# Integração com a Autentique

## Configuração

Configure os secrets somente no Supabase. Os nomes obrigatórios para o fluxo completo são:

- `AUTENTIQUE_WEBHOOK_SECRET`: valida a entrada recebida da Autentique.
- `AUTENTIQUE_API_TOKEN`: consulta o estado atual do documento na API da Autentique.
- `CUSTOMER_WHATSAPP_WEBHOOK_URL`: destino da notificação ao cliente.
- `CUSTOMER_WHATSAPP_WEBHOOK_SECRET`: autentica a saída para o serviço de WhatsApp.

`AUTENTIQUE_WEBHOOK_SECRET` e `CUSTOMER_WHATSAPP_WEBHOOK_SECRET` têm finalidades diferentes e nunca devem ser reutilizados ou trocados entre si.

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

Use formato JSON e selecione `document.created`, `document.updated`, `document.finished`, `document.deleted`, `signature.created`, `signature.updated`, `signature.viewed`, `signature.accepted`, `signature.rejected` e `signature.delivery_failed`. Salve no secret `AUTENTIQUE_WEBHOOK_SECRET` o segredo retornado ao criar o endpoint. A função valida `x-autentique-signature` com HMAC SHA-256 sobre o corpo HTTP original e ignora eventos já concluídos pelo ID.

O gateway JWT deve ser desativado somente para esta função. A configuração local obrigatória é:

```toml
[functions.autentique-webhook]
verify_jwt = false
```

O endpoint possui um health check público e sem dados sensíveis:

```bash
curl -i https://<project-ref>.supabase.co/functions/v1/autentique-webhook
```

A resposta esperada é HTTP 200 com `{"ok":true,"service":"autentique-webhook"}`.

O evento `document.finished` é o único que preenche `approved_at` e dispara a mensagem ao cliente. Eventos `signature.accepted`, `signature.rejected` e `signature.delivery_failed` atualizam cada participante e nunca rebaixam um contrato já aprovado.

Comece obrigatoriamente com `AUTENTIQUE_SANDBOX=true`. Antes de produção, altere o secret para `false`; o modal exige que o ambiente escolhido corresponda ao ambiente configurado no backend. Sandbox não entra na cota. Em produção, a reserva mensal é serializada no banco; somente `super_admin` pode confirmar override acima do limite.

## Implantação e desbloqueio

1. Confirme ou redefina o segredo do endpoint no painel da Autentique.
2. Configure exatamente o mesmo valor no Supabase, sem registrá-lo em arquivo ou log:

   ```bash
   npx supabase secrets set AUTENTIQUE_WEBHOOK_SECRET="SEGREDO_EXATO_DA_AUTENTIQUE"
   ```

3. Aplique as migrations pendentes:

   ```bash
   npx supabase db push
   ```

4. Publique obrigatoriamente sem verificação JWT do gateway:

   ```bash
   npx supabase functions deploy autentique-webhook --no-verify-jwt
   ```

5. Execute o health check e confirme HTTP 200.
6. Consulte os logs da função e confirme que não há `missing_signature`, `invalid_signature`, `invalid_payload` ou erro de banco.
7. Somente então clique em **Desbloquear** no painel da Autentique.
8. Reenvie um evento anteriormente falho ou faça uma assinatura controlada em sandbox.
9. Confirme HTTP 200, atualização do contrato e ausência de notificação duplicada.

Eventos válidos são confirmados rapidamente e processados com `EdgeRuntime.waitUntil`. Falhas posteriores de API, banco, PDF ou WhatsApp ficam registradas em `autentique_webhook_events` para reprocessamento e não transformam o recebimento já validado em erro HTTP.

## Rotação do segredo

Se o valor atual não estiver disponível ou houver dúvida de correspondência:

1. Gere ou redefina o segredo no painel da Autentique.
2. Atualize `AUTENTIQUE_WEBHOOK_SECRET` no Supabase com o mesmo valor.
3. Publique novamente `autentique-webhook --no-verify-jwt`.
4. Teste o health check e um evento assinado em sandbox.
5. Desbloqueie o endpoint somente após os testes passarem.

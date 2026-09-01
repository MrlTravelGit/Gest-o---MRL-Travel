# Alertas de vencimento no Telegram

## Arquitetura

Os alertas são processados exclusivamente pela Edge Function `expiration-alerts`. O frontend recebe somente indicadores booleanos de configuração e o `chat_id` mascarado; o token e o chat completo não fazem parte do bundle Vite, localStorage ou respostas administrativas.

Fontes canônicas:

- pontos: `expiration_lots`, somente `status = active` e `remaining_points > 0`, ligados a conta e cliente ativos;
- gestão: `management_contracts`, somente contrato e cliente ativos;
- deduplicação: `expiration_alerts`, pela combinação cliente, tipo, programa, vencimento e janela.

## Secrets da Edge Function

Configure no projeto Supabase `bdkazlhvnowjehdgxege` sem prefixo `VITE_`:

```powershell
npx supabase secrets set TELEGRAM_BOT_TOKEN="VALOR_SEGURO" TELEGRAM_CHAT_ID="VALOR_SEGURO" ALERTS_TIMEZONE="America/Sao_Paulo" --project-ref bdkazlhvnowjehdgxege
```

Não grave os valores reais em `.env.example`, commits, tickets ou capturas de tela.

## Agendamento seguro

As migrations criam `project_url` e `expiration_alerts_cron_secret` diretamente no Supabase Vault, registram somente o hash SHA-256 na configuração e instalam o cron. Para reconfigurar o agendamento, execute com service role:

```sql
select public.configure_expiration_alerts_cron_v1();
```

O comando armazenado pelo `pg_cron` consulta os secrets diretamente no Vault; nenhum valor é interpolado em `cron.job`. O cron desperta a cada cinco minutos, e a função executa no máximo uma vez por data de `America/Sao_Paulo`, no primeiro ciclo posterior ao horário configurado no painel (padrão 08:00).

## Implantação

```powershell
npx supabase link --project-ref bdkazlhvnowjehdgxege
npx supabase db push --linked --dry-run
npx supabase db push --linked
npx supabase functions deploy expiration-alerts --project-ref bdkazlhvnowjehdgxege --no-verify-jwt
```

Após configurar, use **Configurações · Alertas > Testar Telegram**. O teste envia somente: `Teste de alerta MRL Travel concluído com sucesso.`

## Recuperação

- falha de token ou chat: o registro fica `failed` e pode ser retomado na próxima execução;
- reexecução: alertas `sent` ou `pending` não são duplicados;
- job parado por alguns dias: todas as janelas já alcançadas e ainda não enviadas são recuperadas;
- não há envio de CPF, RG, credenciais, cartões, passaportes ou dados do Cofre Local.

# Arquitetura e segurança

## Atualização 0.4.0 — links diretos e login administrativo

### Link direto do cliente

O link direto novo é uma credencial bearer: quem possuir a URL com token válido poderá iniciar sessão do cliente vinculado. Esse risco é aceito funcionalmente para remover nome, senha e OTP do fluxo novo, e é mitigado por:

1. token aleatório de 256 bits gerado no frontend com `crypto.getRandomValues`;
2. armazenamento somente do SHA-256 do token em `client_direct_access_links`;
3. expiração opcional, revogação imediata e rotação por novo link;
4. troca do token exclusivamente via Edge Function `exchange-client-link`;
5. validação de link ativo, cliente ativo, contrato vigente e vínculo `client_users`;
6. rate limit por fingerprint minimizado em `client_direct_access_events`;
7. eventos de sucesso/falha sem token bruto, e-mail ou dados financeiros;
8. `Referrer-Policy: no-referrer`, limpeza da URL com navegação `replace` e sessão protegida por RLS.

Links antigos por `public_id` continuam no período de transição, mas `public_id` não é convertido em segredo e não autoriza leitura por si só.

### Login administrativo

O painel administrativo usa e-mail e senha individuais via Supabase Auth. MFA TOTP permanece disponível em `/admin/mfa`, mas não bloqueia a entrada. A autorização efetiva continua no backend: `AdminProtectedRoute` faz triagem de UX, enquanto RPCs, Edge Functions e RLS validam `staff_members` ativo e papel autorizado antes de ler ou alterar dados.

### Risco residual

O principal risco residual é encaminhamento, captura por histórico do navegador ou exposição operacional do link bearer. A orientação operacional é gerar links somente após validar a Edge Function em produção, distribuir por canal controlado, revogar links antigos em caso de dúvida e preferir expiração em clientes sensíveis.

## Autoridade de cada camada

| Camada | Responsabilidade |
| :--- | :--- |
| Frontend | Exibir dados e coletar comandos |
| Supabase Auth | Comprovar identidade e emitir sessão |
| Edge Functions | Validar fluxos sensíveis e operações administrativas |
| PostgreSQL | Aplicar integridade, cálculos, transações e RLS |
| Storage | Manter documentos privados |
| Audit Logs | Preservar histórico de alterações |

## Acesso do cliente

```text
Link exclusivo
→ Primeiro nome
→ Backend localiza vínculo sem revelar o resultado
→ Código temporário enviado ao contato cadastrado
→ Código confirmado
→ Sessão Supabase criada
→ RLS valida auth.uid e client_id
→ Dashboard retorna somente os registros permitidos
```

O primeiro nome é um seletor e não uma senha.

## Acesso administrativo

```text
E-mail e senha
→ Verificação de staff_members
→ MFA TOTP opcional/recomendado
→ Sessão Supabase autenticada
→ Operação validada novamente na Edge Function ou RLS
```

## Barreiras contra vazamento

1. `public_id` diferente do ID interno.
2. Sessão obrigatória para ler dados.
3. RLS em todas as tabelas expostas.
4. Funções auxiliares com `search_path` fixo.
5. Chave administrativa somente no backend.
6. Respostas genéricas no pedido de código.
7. Limite por dispositivo e link.
8. Código temporário e desafio com expiração.
9. Storage privado organizado pela pasta do `client_id`.
10. Auditoria das alterações.

## Dados que não serão armazenados

1. Número completo do cartão.
2. CVV.
3. Senha bancária.
4. Senha de programa de fidelidade.
5. Token administrativo no frontend.

## Regras de alteração do banco

1. Toda mudança usa nova migração.
2. Toda tabela nova nasce com RLS.
3. Toda função `security definer` possui validação explícita e `search_path` fixo.
4. Toda permissão é testada com dois usuários diferentes.
5. Operações administrativas críticas passam por Edge Function.

## Ameaças consideradas

| Ameaça | Mitigação |
| :--- | :--- |
| Link encaminhado | Revogação/rotação, expiração opcional e eventos de uso; no fluxo novo o link é credencial bearer |
| Primeiro nome descoberto | Resposta genérica e OTP |
| Tentativa automatizada | Limites e bloqueio |
| Manipulação do frontend | RLS e validação no backend |
| Token administrativo exposto | Segredos fora do Vite |
| Documento acessado por URL | Bucket privado e política por cliente |
| Alteração sem rastreio | Audit log |
| Regra financeira alterada | Fórmula e versão gravadas no registro |

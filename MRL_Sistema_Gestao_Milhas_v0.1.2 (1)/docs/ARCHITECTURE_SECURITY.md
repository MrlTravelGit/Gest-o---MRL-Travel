# Arquitetura e segurança

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
→ MFA TOTP
→ Sessão com AAL2
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
| Link encaminhado | Código temporário e vínculo autenticado |
| Primeiro nome descoberto | Resposta genérica e OTP |
| Tentativa automatizada | Limites e bloqueio |
| Manipulação do frontend | RLS e validação no backend |
| Token administrativo exposto | Segredos fora do Vite |
| Documento acessado por URL | Bucket privado e política por cliente |
| Alteração sem rastreio | Audit log |
| Regra financeira alterada | Fórmula e versão gravadas no registro |

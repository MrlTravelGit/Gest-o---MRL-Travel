# Patch MRL 025 — Clubes e catálogo de cartões

Data: 24/07/2026

## Implementação

- A fonte canônica do Patch 018 (`loyalty_club_plans`, benefícios, assinaturas e créditos previstos) foi evoluída; nenhuma segunda fonte de clubes foi criada.
- Foram cadastrados Esfera Pro, Master, VIP e Exclusive, além do produto separado Smiles + Streaming 1.000.
- O preço `a partir de` do Smiles foi persistido como `from`; o valor pago é obrigatório no vínculo.
- O bônus de adesão de 14.500 milhas fica em `club_joining_bonus_credits`, separado dos 1.000 mensais, e exige oferta, data e justificativa da elegibilidade.
- O catálogo possui 54 produtos e 102 regras versionadas.
- `official_up_to` nunca calcula automaticamente. A taxa individual exige unidade, justificativa e fonte.
- Faturas recebem segmentos nacionais, internacionais e de parceiro; a regra mais específica substitui a geral.
- Cálculo, cotação, versão e aplicações de regra são congelados no backend.

## Produção

- Migration `202607240030_club_card_catalog_and_points_engine.sql` aplicada no projeto `bdkazlhvnowjehdgxege`.
- Frontend publicado no deployment `dpl_DbPQTVtCBVGGUBwfMs7eZD7RXjNN`.
- Alias oficial: `https://gestao-mrltravel.vercel.app`.
- `/admin/cartoes` respondeu HTTP 200 após o deploy.

Conferência somente leitura realizada após a migration:

| Invariante | Produção |
|---|---:|
| Produtos novos de clube | 5 |
| Produtos de cartão v1 | 54 |
| Regras de cartão | 102 |
| Produtos `official_up_to` habilitados | 0 |
| Economias legadas | 68 |
| Total de economia legado | R$ 130.404,85 |
| Pontos migrados | 3.080.020 |
| Clientes preservados | 30 |
| Contratos preservados | 22 |
| Links diretos preservados | 40 |
| Movimentos de cashback preservados | 4 |

Produtos inicialmente marcados para revisão:

- LATAM Pass Itaú Mastercard Black
- C6 Mastercard Black
- CAIXA Ícone Visa
- Porto Bank Gold
- Porto Bank Platinum
- Porto Bank Mastercard Black
- Porto Bank Visa Infinite
- Nubank Ultravioleta Mastercard Black
- Unicred Ímpar Visa Infinite

## Testes

- 30 testes pgTAP do Patch 025 aprovados.
- 27 arquivos / 102 testes Vitest aprovados.
- Typecheck e build de produção aprovados.
- A migration foi reaplicada repetidamente no banco local sem criar duplicidades.
- Testes cobrem Esfera, Smiles + Streaming, dólar, real, denominador, Azul, GOL, Pão de Açúcar, Sicredi, Altus, regra vencida, `official_up_to`, taxa personalizada, auditoria, RLS e congelamento de versão.

## Validação transacional

`202607240031_patch025_production_validation.sql` executa as invariantes de produção e cria, associa e calcula cartões temporários dentro de uma subtransação deliberadamente revertida. Assim, a validação falha se houver divergência e não deixa cliente, cartão, fatura ou auditoria de teste.

# Protocolo de patches MRL

Toda demanda deverá produzir uma alteração controlada.

## Fluxo obrigatório

```text
Entender
→ Inspecionar o código atual
→ Identificar a causa ou ampliação
→ Mapear impactos
→ Preparar o menor patch seguro
→ Atualizar migrações quando necessário
→ Executar testes
→ Atualizar a documentação
→ Entregar instruções de publicação
```

## Conteúdo da entrega

1. Demanda recebida.
2. Diagnóstico.
3. Causa principal.
4. Arquivos alterados.
5. Banco e migrações.
6. Segurança e permissões.
7. Testes executados.
8. Riscos restantes.
9. Publicação.
10. Reversão.

## Regras

1. Não reescrever arquivos sem necessidade.
2. Não editar migrações já aplicadas.
3. Não confiar em validações exclusivas do frontend.
4. Não expor dados ou segredos em logs.
5. Não alterar fórmula histórica sem versionamento.
6. Não remover RLS para contornar erro.
7. Não misturar refatorações não relacionadas.
8. Preservar reservas, hospedagens e sistemas externos existentes.

## Conclusão da demanda

Uma demanda somente está concluída quando build, testes direcionados, teste de isolamento e documentação estiverem aprovados.

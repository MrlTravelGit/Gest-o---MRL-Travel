# Relatório de validação

## Versão

| Campo | Valor |
| :--- | :--- |
| Projeto | Sistema de Gestão de Milhas MRL Travel |
| Versão | 0.1.2 |
| Data | 15/07/2026 |

## Verificações aprovadas

| Verificação | Resultado |
| :--- | :--- |
| TypeScript | Aprovado |
| Testes automatizados | 6 testes aprovados em 2 arquivos |
| Build de produção | Aprovado com Vite 8.1.4 |
| Divisão de bundles | Aprovada |
| Auditoria de dependências | 0 vulnerabilidades encontradas |
| Busca por chave administrativa no frontend | Nenhuma chave encontrada |
| CORS com origem universal | Não encontrado nas funções |
| Arquivos `.env` reais | Não incluídos |
| Project URL e Project Ref | Configurados |
| Publishable Key | Configurada e validada pelo schema do frontend |
| Endpoint remoto de Auth | HTTP 200 |
| Login remoto por e-mail | Habilitado |
| Cadastro público remoto | Habilitado, bloqueio necessário antes da produção |
| Rejeição de variáveis fictícias | 3 testes adicionados |

## Cobertura atual

1. Fórmula de pontos por real.
2. Fórmula de pontos por dólar.
3. Fórmula de economia gerada.
4. Validação estática do frontend.
5. Geração do bundle usado pela Vercel.

## Validações que dependem do projeto Supabase

Os seguintes testes precisam ser executados depois do vínculo autenticado com o projeto Supabase:

1. Aplicação real das migrações PostgreSQL.
2. Envio de código pelo SMTP ou provedor SMS configurado.
3. Verificação real do código e criação da sessão.
4. Cadastro do primeiro administrador.
5. MFA TOTP no projeto remoto.
6. Cadastro administrativo de cliente.
7. Consulta do dashboard por RPC.
8. Teste RLS cruzado com dois clientes.
9. Upload e leitura de arquivos privados.
10. Implantação no domínio da Vercel.

## Bloqueio de segurança atual

O Supabase remoto informou `disable_signup: false`. Isso significa que o cadastro público ainda está habilitado. Antes da publicação, altere essa configuração em Authentication para impedir a criação livre de usuários. O frontend não oferece uma tela de cadastro, mas essa ausência não substitui o bloqueio no backend.

O Project Ref, a URL e a Publishable Key já foram definidos. Esses itens ainda dependem do vínculo administrativo da CLI, da senha do banco e da configuração de autenticação do Supabase.

# PATCH 033 — relatório de validação

Data: 26/08/2026

## Resultado automatizado

- Cofre local: `npm ci` — aprovado, sem vulnerabilidades reportadas.
- Cofre local: `npm run typecheck` — aprovado.
- Cofre local: `npm test` — 14/14 aprovados.
- Cofre local: `npm run build` — aprovado; frontend e servidor gerados isoladamente, sem compilar arquivos de teste para produção.
- Gestão: `npm run typecheck` — aprovado.
- Gestão: teste focado de integração — 2/2 aprovados.
- Gestão: `npm run build` — aprovado.
- Gestão: suíte completa — 120/121 aprovados. A única falha é preexistente em `notion-import-parser.test.ts` e decorre da ausência do ZIP real do Notion esperado pela fixture.
- Scripts PowerShell — todos analisados com sucesso pelo parser local.
- Busca pelo mecanismo de autenticação removido — zero ocorrências no aplicativo, scripts e documentação operacional.

## Contratos cobertos

Os testes do cofre verificam IPv4 privado e rejeição de endereço público, APIPA e loopback; serviço automático; reinício após falha; atraso e rotação de logs; preservação de `.env`, conta do serviço e diretórios operacionais; CA persistente; renovação do certificado; SAN privado; backup do certificado anterior; firewall Private/LocalSubnet; ausência de pacote para estações; senha mínima e contrato de login local.

A integração da Gestão confirma o endereço `https://192.168.0.25:7443/clients/{client_id}` sem query string ou outros dados.

## Validação visual

O build de produção do login foi aberto em navegador real em desktop e em 390 × 844.

- Exatamente dois campos: usuário e senha.
- Preenchimento automático desabilitado como sinalização adicional à política corporativa do navegador.
- Logo oficial, fundo `rgb(5, 7, 9)` e tipografia sem serifa.
- Título, subtítulo e identificação de ambiente conforme a especificação.
- Sem overflow horizontal. No viewport móvel, o cartão permaneceu entre 24 px e 366 px.

## Validação física pendente

Não foram instalados serviço, certificado, regra de firewall ou CA nesta estação de desenvolvimento. A homologação final precisa ser feita no servidor Windows `192.168.0.25` e em pelo menos uma estação administrativa da mesma rede. Ela deve confirmar início após reboot sem login, acesso HTTPS pelo navegador interno e indisponibilidade fora da rede privada.

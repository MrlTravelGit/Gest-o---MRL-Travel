# PATCH 033 — servidor permanente do Cofre Local

## Endereço oficial

O servidor deve possuir reserva DHCP para `192.168.0.25`. Essa reserva é feita no roteador por um administrador da rede; os scripts não modificam DHCP, roteador, UPnP ou encaminhamento de portas.

O endereço cotidiano é `https://192.168.0.25:7443`. O serviço vincula diretamente ao IPv4 privado e a porta não deve ser publicada na internet.

## Primeira preparação do servidor

1. Instale Node.js 24 LTS, PowerShell 7 e NSSM somente no servidor.
2. Garanta que `node`, `npm`, `pwsh` e `nssm.exe` estejam no `PATH` do sistema.
3. Preserve `C:\ProgramData\MRLTravel\Vault`; nunca mova seu conteúdo para o diretório do site.
4. Reserve `192.168.0.25` no DHCP e confirme que o perfil da conexão do Windows é `Private`.
5. Execute `INICIAR-COFRE.cmd`. Aceite a elevação UAC.
6. Se o primeiro administrador ainda não existir, execute `npm run vault:init` uma única vez na conta que operará o cofre.

Na primeira instalação do serviço, o inicializador solicita de forma protegida a senha da conta Windows atual para que o NSSM use a mesma identidade vinculada à chave mestra DPAPI. A senha existe apenas em memória durante essa configuração e não é gravada no CMD, `.env` ou logs. Execuções posteriores preservam `.env`, conta do serviço, banco, documentos, usuários, sessões compatíveis e chave mestra sem pedir novamente a senha. O build só é refeito quando ausente ou desatualizado. O certificado só é renovado quando o IP não estiver no SAN ou faltarem menos de 30 dias para vencer.

Se o IP detectado divergir do oficial, o script interrompe a execução não interativa. Em uso manual, ele explica a divergência e exige a confirmação literal `ATUALIZAR`; prefira corrigir a reserva DHCP antes de aceitar uma mudança.

## Serviço e recuperação automática

`MRLClientVault` usa início automático, reinício após falha, atraso entre reinícios e rotação de `stdout.log` e `stderr.log` em `C:\ProgramData\MRLTravel\Vault\logs`. Uma instalação existente é ajustada sem trocar sua conta de serviço. Uma instalação nova usa a conta Windows atual, garantindo compatibilidade com o DPAPI.

Depois da implantação, reinicie o servidor em uma janela controlada e confirme com `DIAGNOSTICAR-COFRE.cmd` que o serviço voltou sem login interativo.

## Confiança HTTPS nas estações

Distribua somente `C:\ProgramData\MRLTravel\Vault\certificates\mrl-vault-ca.crt` por política corporativa do Windows ou importação administrativa no repositório de autoridades raiz confiáveis da máquina. Nunca distribua arquivos de chave, `.env`, banco, documentos ou código.

Essa preparação é feita uma vez por estação. A mesma autoridade é preservada nas renovações, portanto o uso diário consiste apenas em abrir o endereço no Chrome, Edge ou navegador autorizado e informar usuário e senha.

Não desative a validação TLS e não crie exceção permanente de certificado. Defina por política corporativa que o navegador não ofereça nem salve senhas do domínio/IP do cofre.

## Firewall

A regra única `MRL Client Vault, Rede Privada` permite entrada TCP 7443 no perfil `Private`, origem `LocalSubnet`, vinculada ao executável Node.js do serviço. O modo avançado aceita uma lista de IPv4 privados:

```powershell
.\scripts\start-vault.ps1 -AllowedRemoteAddress 192.168.0.31,192.168.0.32
```

O script remove somente regras antigas cujo nome pertence ao próprio Cofre Local. Não cria acesso no perfil Public, túnel ou regra no roteador.

## Operação e incidentes

- Iniciar ou reparar: `INICIAR-COFRE.cmd`.
- Diagnosticar sem mutar dados: `DIAGNOSTICAR-COFRE.cmd`.
- Parar em manutenção: `PARAR-COFRE.cmd` e confirmar com `PARAR`.
- Logs: `C:\ProgramData\MRLTravel\Vault\logs`.
- URL da Gestão: `VITE_LOCAL_VAULT_URL=https://192.168.0.25:7443`.

Se houver suspeita de comprometimento, pare o serviço, preserve banco/logs/certificados e use os comandos administrativos de revogação. Não apague a pasta operacional durante investigação.

## Homologação física obrigatória

No servidor, confirme bind em `192.168.0.25`, saúde HTTPS, início automático e retorno após reinício do Windows. Em pelo menos uma estação na mesma rede, instale somente a CA pública, abra o cofre pelo navegador e valide o login. Em uma rede externa, confirme que o endereço não responde.

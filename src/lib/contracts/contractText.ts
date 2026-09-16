import { formatContractCurrency, formatPercentage, numberToWords, percentageToWords } from "./contractFormat";
import type { ContractDraft } from "@/types/contracts";

export const CONTRACTOR = {
  name: "MRL TRAVEL",
  cnpj: "30.724.993/0001-05",
  address: "Rua Visconde de Nacar, 1505, SALA 1106. Bairro: Centro. CEP: 80410-201. Curitiba/PR",
  representative: "MICHAEL FELIPE RESENDE BRAGANÇA SOUSA",
  forum: "POMPÉU/MG",
  defaultCity: "POMPÉU",
  witnessOneCpf: "124.674.296-95",
  witnessTwoCpf: "157.386.726.82",
} as const;

export interface ContractBlock {
  type: "paragraph" | "bullet";
  text: string;
}

export interface ContractClause {
  number: number;
  title: string;
  blocks: ContractBlock[];
}

function paymentText(draft: ContractDraft): string {
  const total = formatContractCurrency(draft.contractValue);
  if (draft.installments > 1) {
    return "A CONTRATANTE pagará à CONTRATADA o valor de R$ " + total +
      ", por meio de Pix ou cartão de crédito, em parcelas até " + draft.installments +
      " (" + numberToWords(draft.installments) + ") vezes de R$ " +
      formatContractCurrency(draft.installmentValue) + " via link de pagamento.";
  }
  return "A CONTRATANTE pagará à CONTRATADA o valor de R$ " + total +
    ", por meio de Pix ou cartão de crédito, à vista, via link de pagamento.";
}

function fixedClauses(draft: ContractDraft): Omit<ContractClause, "number">[] {
  const clauses: Omit<ContractClause, "number">[] = [
    {
      title: "OBJETO",
      blocks: [
        { type: "paragraph", text: "A CONTRATADA prestará à CONTRATANTE os seguintes serviços de gestão de milhas, durante o período de 12 (doze) meses:" },
        { type: "bullet", text: "Consultoria e análise personalizada de cartões para maximização do acúmulo de milhas;" },
        { type: "bullet", text: "Gerenciamento dos programas Livelo, Esfera, Smiles, Latam Pass, TudoAzul, Iberia Plus, TAP Miles&Go e outros vinculados a cartões;" },
        { type: "bullet", text: "Envio de alertas sobre promoções de passagens, transferências bonificadas e acúmulo de pontos;" },
        { type: "bullet", text: "Emissão de passagens, hospedagens, seguros, transfers e aluguel de veículos;" },
        { type: "bullet", text: "Suporte completo no pré, durante e pós-viagem via WhatsApp, de segunda a sexta-feira, das 09h00 às 12h00 e das 13h00 às 18h00;" },
        { type: "bullet", text: "Para demandas urgentes fora do horário comercial, o time da CONTRATADA fará o possível para atender no mesmo dia, desde que a solicitação envolva interesse de conclusão imediata;" },
        { type: "bullet", text: "Mesmo fora do horário de atendimento, os check-ins de voos serão enviados normalmente;" },
        { type: "bullet", text: "Em casos de problemas com voos, a CONTRATADA fornecerá suporte jurídico emergencial 24 horas;" },
        { type: "bullet", text: "Relatórios semestrais de desempenho;" },
      ],
    },
    {
      title: "VALOR E PAGAMENTO",
      blocks: [
        { type: "paragraph", text: paymentText(draft) },
        { type: "paragraph", text: "Em caso de contestação indevida (chargeback), a CONTRATANTE reconhece que:" },
        { type: "bullet", text: "Tal ato configura má-fé e descumprimento contratual;" },
        { type: "bullet", text: "Estará sujeita à multa compensatória de 100% do valor total do contrato;" },
        { type: "bullet", text: "Deverá reembolsar quaisquer taxas, honorários e custos judiciais causados;" },
        { type: "bullet", text: "Poderá ser responsabilizada civilmente por eventuais perdas e danos." },
      ],
    },
    {
      title: "OBRIGAÇÕES DA CONTRATANTE",
      blocks: [
        { type: "bullet", text: "Fornecer as informações e dados solicitados;" },
        { type: "bullet", text: "Responder os formulários de onboarding enviados pela CONTRATADA;" },
        { type: "bullet", text: "Enviar logins e senhas dos programas Livelo, Esfera, Latam Pass, TudoAzul e Smiles;" },
        { type: "bullet", text: "Participar de 1 (uma) call inicial de onboarding;" },
        { type: "bullet", text: "Detalhar todas as solicitações de serviços com clareza;" },
        { type: "bullet", text: "Enviar os códigos de segurança recebidos por SMS ou e-mail para concluir promoções de pontos e milhas;" },
        { type: "bullet", text: "Atualizar saldos de programas que não estejam sob acesso da CONTRATADA." },
      ],
    },
    {
      title: "OBRIGAÇÕES DA CONTRATADA",
      blocks: [
        { type: "paragraph", text: "A CONTRATADA atua como intermediadora na contratação de serviços prestados por terceiros, como companhias aéreas, hotéis, locadoras de veículos, seguradoras, entre outros. Em situações como atrasos ou cancelamentos de voos, extravio de bagagem, problemas com hospedagem ou aluguel de veículos, a responsabilidade é exclusivamente da empresa prestadora do serviço. Nestes casos, a CONTRATADA fornecerá suporte jurídico emergencial 24 horas para auxiliar a CONTRATANTE na defesa de seus direitos junto aos responsáveis." },
        { type: "paragraph", text: "No que se refere a problemas operacionais com programas de milhagem (como falhas em transferências, acesso, resgates ou pontuações), a CONTRATADA é responsável pela gestão ativa, correção e acompanhamento de soluções diretamente com os respectivos programas e plataformas." },
        { type: "paragraph", text: "Além disso, cabe à CONTRATADA:" },
        { type: "bullet", text: "Realizar o gerenciamento dos pontos e milhas conforme descrito;" },
        { type: "bullet", text: "Executar cotações e emissões de pedidos conforme solicitado;" },
        { type: "bullet", text: "Prestar atendimento completo no pré, durante e pós-venda;" },
        { type: "bullet", text: "Zelar pelas informações da CONTRATANTE, garantindo confidencialidade e segurança." },
      ],
    },
    {
      title: "RESCISÃO E CANCELAMENTO",
      blocks: [
        { type: "paragraph", text: "O contrato é válido por 12 (doze) meses. A CONTRATANTE poderá solicitar cancelamento:" },
        { type: "bullet", text: "Até 7 dias corridos após a contratação, com reembolso integral (conforme art. 49 do CDC);" },
        { type: "bullet", text: "Entre o 8º e o 30º dia corrido, com reembolso de 85% do valor pago;" },
        { type: "bullet", text: "Após 30 dias, não haverá reembolso, em razão do modelo de entrega anual antecipada e contínua." },
        { type: "paragraph", text: "Caso a CONTRATADA desista da execução do serviço, deverá entregar gratuitamente todos os materiais produzidos até então." },
      ],
    },
    {
      title: "CONFIDENCIALIDADE E PROTEÇÃO DE DADOS (LGPD)",
      blocks: [
        { type: "paragraph", text: "As partes comprometem-se a manter sigilo absoluto de todas as informações e dados compartilhados, em conformidade com a Lei Geral de Proteção de Dados (Lei nº 13.709/2018)." },
        { type: "paragraph", text: "A CONTRATADA armazena os acessos fornecidos em ambiente seguro e criptografado, , com acesso restrito ao time autorizado e treinado." },
        { type: "paragraph", text: "A CONTRATANTE reconhece que, embora raros, casos de invasão por terceiros (hackers) podem ocorrer. Nestes casos:" },
        { type: "bullet", text: "A CONTRATADA compromete-se a apurar os fatos com apoio jurídico;" },
        { type: "bullet", text: "A CONTRATADA não será responsabilizada por eventuais prejuízos decorrentes de ações externas alheias ao seu controle;" },
        { type: "bullet", text: "Não se presumirá culpa da CONTRATADA sem apuração técnica." },
        { type: "paragraph", text: "Em caso de vazamento de dados por negligência da CONTRATADA, será aplicada multa de R$ 100.000,00 (cem mil reais), além de sanções legais cabíveis." },
      ],
    },
  ];
  if (draft.includeCourtesyTicket) clauses[0].blocks.push({ type: "bullet", text: "1 Passagem cortesia para qualquer destino do Brasil IDA e VOLTA a solicitação da mesma deve ser feita com no mínimo 30 dias antes do embarque" });
  return clauses;
}

function cashbackClause(percent: number): Omit<ContractClause, "number"> {
  return {
    title: "PROGRAMA DE CASHBACK POR VIAGENS CONTRATADAS",
    blocks: [
      { type: "paragraph", text: "A CONTRATANTE fará jus a um benefício de cashback de " + formatPercentage(percent) + " (" + percentageToWords(percent) + ") sobre o valor total de cada pacote ou serviço de viagem contratado diretamente através da MRL TRAVEL, nas seguintes hipóteses:" },
      { type: "bullet", text: "Viagens corporativas custeadas ou reembolsadas pela empresa do(a) CONTRATANTE, desde que a contratação seja realizada por intermédio da CONTRATADA;" },
      { type: "bullet", text: "Viagens geradas por indicações feitas pelo(a) CONTRATANTE a terceiros, que resultem em contratação efetiva junto à CONTRATADA." },
      { type: "paragraph", text: "Forma de apuração e utilização do cashback:" },
      { type: "bullet", text: "O cashback será apurado mensalmente pela CONTRATADA com base nos serviços efetivamente contratados e pagos no período;" },
      { type: "bullet", text: "O saldo acumulado poderá ser utilizado pelo(a) CONTRATANTE, a seu critério, nas seguintes modalidades: (a) crédito para abatimento em futuras contratações de viagens junto à MRL TRAVEL; ou (b) devolução em dinheiro via Pix, mediante solicitação expressa ao(à) CONTRATANTE;" },
      { type: "bullet", text: "A opção pela modalidade de utilização (crédito ou Pix) deverá ser comunicada pelo(a) CONTRATANTE por escrito (WhatsApp ou e-mail) até o último dia do mês de apuração. Na ausência de manifestação, o saldo será mantido como crédito automaticamente;" },
      { type: "bullet", text: "Quando optado pelo Pix, o pagamento será realizado pela CONTRATADA até o 10º dia útil do mês subsequente à apuração, para a chave Pix cadastrada pelo(a) CONTRATANTE;" },
      { type: "bullet", text: "O saldo em crédito será informado ao(à) CONTRATANTE por escrito (WhatsApp ou e-mail) até o 5º dia útil do mês subsequente à apuração;" },
      { type: "bullet", text: "Créditos não utilizados até o término do presente contrato poderão ser transferidos para eventual renovação ou convertidos em Pix, a critério do(a) CONTRATANTE mediante solicitação expressa." },
      { type: "paragraph", text: "Exclusões:" },
      { type: "bullet", text: "Não incidirá cashback sobre serviços cancelados, estornados ou objetos de chargeback;" },
      { type: "bullet", text: "Indicações que não resultem em contratação efetiva e paga não geram direito a cashback;" },
      { type: "bullet", text: "O benefício de cashback não é cumulativo com outras promoções ou descontos concedidos pontualmente pela CONTRATADA, salvo acordo expresso em contrário." },
    ],
  };
}

function roiClause(): Omit<ContractClause, "number"> {
  return {
    title: "GARANTIA DE RETORNO DE INVESTIMENTO",
    blocks: [
      { type: "bullet", text: "A CONTRATADA se compromete a gerar, no mínimo, o valor total investido pelo(a) CONTRATANTE em forma de descontos ou economias obtidas durante a gestão dos pontos/milhas em programas de fidelidades, conforme estipulado no presente contrato." },
      { type: "bullet", text: "Reembolso da Diferença: Caso o(a) CONTRATANTE não obtenha o valor equivalente ao investimento inicial por meio dos referidos descontos ou economias até o término da prestação dos serviços, a CONTRATADA compromete-se a reembolsar ao(à) CONTRATANTE a diferença entre o valor investido e o valor efetivamente economizado ou obtido em forma de desconto." },
      { type: "bullet", text: "Prazos e Condições: O reembolso da diferença deverá ser solicitado por escrito pelo(a) CONTRATANTE em até 15 dias após o término do contrato, apresentando a comprovação dos valores não atingidos, sendo o valor ressarcido pela CONTRATADA em até 30 dias após o recebimento da solicitação." },
      { type: "bullet", text: "Exclusões: Esta garantia não será aplicável nos casos em que o não atingimento do valor investido decorra de falta de colaboração ou cumprimento das obrigações por parte do(a) CONTRATANTE, conforme previsto nas demais cláusulas do contrato." },
    ],
  };
}

function finalClauses(): Omit<ContractClause, "number">[] {
  return [
    {
      title: "DISPOSIÇÕES GERAIS",
      blocks: [
        { type: "bullet", text: "Este contrato não gera vínculo empregatício entre as partes;" },
        { type: "bullet", text: "Alterações somente terão validade mediante acordo escrito e assinado;" },
        { type: "bullet", text: "As obrigações são intransferíveis sem autorização expressa;" },
        { type: "bullet", text: "A eventual nulidade de uma cláusula não invalida o restante do contrato;" },
        { type: "bullet", text: "A tolerância quanto a descumprimentos não representa renúncia de direitos;" },
        { type: "bullet", text: "Qualquer outro contrato verbal ou escrito anterior é automaticamente substituído por este." },
      ],
    },
    {
      title: "FORO",
      blocks: [
        { type: "paragraph", text: "Este contrato poderá ser assinado física ou digitalmente, por meio de plataformas como Docusign, Clicksign ou similares, sendo as assinaturas eletrônicas consideradas válidas e eficazes, nos termos da Medida Provisória nº 2.200-2/2001, com valor jurídico equivalente ao da assinatura física." },
        { type: "paragraph", text: "Fica eleito o foro da Comarca de " + CONTRACTOR.forum + " para dirimir quaisquer dúvidas ou controvérsias oriundas deste contrato, com renúncia a qualquer outro, por mais privilegiado que seja." },
        { type: "paragraph", text: "E, por estarem de pleno acordo, as partes assinam o presente instrumento, física ou digitalmente, conferindo-lhe eficácia de título executivo extrajudicial.\"" },
      ],
    },
  ];
}

export function buildContractClauses(draft: ContractDraft): ContractClause[] {
  const clauses = fixedClauses(draft);
  if (draft.includeCashback) clauses.push(cashbackClause(draft.cashbackPercent));
  if (draft.includeRoiGuarantee) clauses.push(roiClause());
  clauses.push(...finalClauses());
  return clauses.map((clause, index) => ({ ...clause, number: index + 1 }));
}

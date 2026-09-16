import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "npm:pdf-lib@1.17.1";

export interface ContractData {
  nome: string;
  cpf: string;
  rg: string;
  email: string;
  estado_civil: string;
  profissao: string;
  endereco: string;
  valor_total: number;
  num_parcelas: number;
  valor_parcela: number;
  data: string;
  cidade: string;
  incluir_cashback: boolean;
  pct_cashback: number;
  incluir_reembolso: boolean;
}

const CONTRACTOR = {
  name: "MRL TRAVEL",
  cnpj: "30.724.993/0001-05",
  address: "Rua Visconde de Nacar, 1505, sala 1106, Centro, CEP 80410-201, Curitiba/PR",
  representative: "MICHAEL FELIPE RESENDE BRAGANÇA SOUSA",
  forum: "POMPÉU/MG",
};

const money = (value: number) => new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
const valueOr = (value: string, fallback = "não informado") => value.trim() || fallback;
const safePdfText = (value: string) => value.replace(/[\u2013\u2014]/g, "-").replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"').replace(/\u2026/g, "...");

function contractSections(data: ContractData): Array<{ title: string; paragraphs: string[] }> {
  const payment = data.num_parcelas > 1
    ? `A CONTRATANTE pagará à CONTRATADA o valor de R$ ${money(data.valor_total)}, em até ${data.num_parcelas} parcelas de R$ ${money(data.valor_parcela)}, via Pix, cartão de crédito ou link de pagamento.`
    : `A CONTRATANTE pagará à CONTRATADA o valor de R$ ${money(data.valor_total)}, à vista, via Pix, cartão de crédito ou link de pagamento.`;
  const sections = [
    { title: "OBJETO", paragraphs: [
      "A CONTRATADA prestará à CONTRATANTE os seguintes serviços de gestão de milhas, durante o período de 12 (doze) meses:",
      "• Consultoria e análise personalizada de cartões para maximização do acúmulo de milhas;",
      "• Gerenciamento dos programas Livelo, Esfera, Smiles, Latam Pass, TudoAzul, Iberia Plus, TAP Miles&Go e outros vinculados a cartões;",
      "• Envio de alertas sobre promoções de passagens, transferências bonificadas e acúmulo de pontos;",
      "• Emissão de passagens, hospedagens, seguros, transfers e aluguel de veículos;",
      "• Suporte completo no pré, durante e pós-viagem via WhatsApp, de segunda a sexta-feira, das 09h00 às 12h00 e das 13h00 às 18h00;",
      "• Para demandas urgentes fora do horário comercial, o time da CONTRATADA fará o possível para atender no mesmo dia, desde que a solicitação envolva interesse de conclusão imediata;",
      "• Mesmo fora do horário de atendimento, os check-ins de voos serão enviados normalmente;",
      "• Em casos de problemas com voos, a CONTRATADA fornecerá suporte jurídico emergencial 24 horas;",
      "• Relatórios semestrais de desempenho.",
    ] },
    { title: "VALOR E PAGAMENTO", paragraphs: [
      payment,
      "Em caso de contestação indevida (chargeback), a CONTRATANTE reconhece que:",
      "• Tal ato configura má-fé e descumprimento contratual;",
      "• Estará sujeita à multa compensatória de 100% do valor total do contrato;",
      "• Deverá reembolsar quaisquer taxas, honorários e custos judiciais causados;",
      "• Poderá ser responsabilizada civilmente por eventuais perdas e danos.",
    ] },
    { title: "OBRIGAÇÕES DA CONTRATANTE", paragraphs: [
      "• Fornecer as informações e dados solicitados;",
      "• Responder os formulários de onboarding enviados pela CONTRATADA;",
      "• Enviar logins e senhas dos programas Livelo, Esfera, Latam Pass, TudoAzul e Smiles;",
      "• Participar de 1 (uma) call inicial de onboarding;",
      "• Detalhar todas as solicitações de serviços com clareza;",
      "• Enviar os códigos de segurança recebidos por SMS ou e-mail para concluir promoções de pontos e milhas;",
      "• Atualizar saldos de programas que não estejam sob acesso da CONTRATADA.",
    ] },
    { title: "OBRIGAÇÕES DA CONTRATADA", paragraphs: [
      "A CONTRATADA atua como intermediadora na contratação de serviços prestados por terceiros, como companhias aéreas, hotéis, locadoras de veículos, seguradoras, entre outros. Em situações como atrasos ou cancelamentos de voos, extravio de bagagem, problemas com hospedagem ou aluguel de veículos, a responsabilidade é exclusivamente da empresa prestadora do serviço. Nestes casos, a CONTRATADA fornecerá suporte jurídico emergencial 24 horas para auxiliar a CONTRATANTE na defesa de seus direitos junto aos responsáveis.",
      "No que se refere a problemas operacionais com programas de milhagem (como falhas em transferências, acesso, resgates ou pontuações), a CONTRATADA é responsável pela gestão ativa, correção e acompanhamento de soluções diretamente com os respectivos programas e plataformas.",
      "Além disso, cabe à CONTRATADA:",
      "• Realizar o gerenciamento dos pontos e milhas conforme descrito;",
      "• Executar cotações e emissões de pedidos conforme solicitado;",
      "• Prestar atendimento completo no pré, durante e pós-venda;",
      "• Zelar pelas informações da CONTRATANTE, garantindo confidencialidade e segurança.",
    ] },
    { title: "RESCISÃO E CANCELAMENTO", paragraphs: [
      "O contrato é válido por 12 (doze) meses. A CONTRATANTE poderá solicitar cancelamento:",
      "• Até 7 dias corridos após a contratação, com reembolso integral (conforme art. 49 do CDC);",
      "• Entre o 8º e o 30º dia corrido, com reembolso de 85% do valor pago;",
      "• Após 30 dias, não haverá reembolso, em razão do modelo de entrega anual antecipada e contínua.",
      "Caso a CONTRATADA desista da execução do serviço, deverá entregar gratuitamente todos os materiais produzidos até então.",
    ] },
    { title: "CONFIDENCIALIDADE E PROTEÇÃO DE DADOS (LGPD)", paragraphs: [
      "As partes comprometem-se a manter sigilo absoluto de todas as informações e dados compartilhados, em conformidade com a Lei Geral de Proteção de Dados (Lei nº 13.709/2018).",
      "A CONTRATADA armazena os acessos fornecidos em ambiente seguro e criptografado, com acesso restrito ao time autorizado e treinado.",
      "A CONTRATANTE reconhece que, embora raros, casos de invasão por terceiros (hackers) podem ocorrer. Nestes casos:",
      "• A CONTRATADA compromete-se a apurar os fatos com apoio jurídico;",
      "• A CONTRATADA não será responsabilizada por eventuais prejuízos decorrentes de ações externas alheias ao seu controle;",
      "• Não se presumirá culpa da CONTRATADA sem apuração técnica.",
      "Em caso de vazamento de dados por negligência da CONTRATADA, será aplicada multa de R$ 100.000,00 (cem mil reais), além de sanções legais cabíveis.",
    ] },
  ];
  if (data.incluir_cashback) sections.push({ title: "PROGRAMA DE CASHBACK POR VIAGENS CONTRATADAS", paragraphs: [
    `A CONTRATANTE fará jus a um benefício de cashback de ${money(data.pct_cashback)}% sobre o valor total de cada pacote ou serviço de viagem contratado diretamente através da MRL TRAVEL, nas hipóteses previstas neste instrumento.`,
    "• O cashback será apurado mensalmente com base nos serviços efetivamente contratados e pagos;",
    "• O saldo poderá ser utilizado como crédito em futuras viagens ou devolvido via Pix, mediante solicitação expressa;",
    "• Quando optado pelo Pix, o pagamento será realizado até o 10º dia útil do mês subsequente à apuração;",
    "• Não haverá cashback sobre serviços cancelados, estornados ou objeto de chargeback;",
    "• O benefício não é cumulativo com outras promoções ou descontos, salvo acordo expresso.",
  ] });
  if (data.incluir_reembolso) sections.push({ title: "GARANTIA DE RETORNO DE INVESTIMENTO", paragraphs: [
    "• A CONTRATADA se compromete a gerar, no mínimo, o valor total investido em forma de descontos, cashbacks ou economias obtidas durante a gestão;",
    "• Caso o valor não seja atingido até o término, a CONTRATADA reembolsará a diferença entre o investimento e o valor efetivamente economizado;",
    "• O pedido deverá ser feito por escrito em até 15 dias após o término do contrato, com pagamento em até 30 dias após a solicitação;",
    "• A garantia não se aplica quando o resultado decorrer de falta de colaboração ou descumprimento das obrigações da CONTRATANTE.",
  ] });
  sections.push(
    { title: "DISPOSIÇÕES GERAIS", paragraphs: [
      "• Este contrato não gera vínculo empregatício entre as partes;",
      "• Alterações somente terão validade mediante acordo escrito e assinado;",
      "• As obrigações são intransferíveis sem autorização expressa;",
      "• A eventual nulidade de uma cláusula não invalida o restante do contrato;",
      "• A tolerância quanto a descumprimentos não representa renúncia de direitos;",
      "• Qualquer outro contrato verbal ou escrito anterior é automaticamente substituído por este.",
    ] },
    { title: "FORO", paragraphs: [
      "Este contrato poderá ser assinado física ou digitalmente, por meio de plataformas como Docusign, Clicksign ou similares, sendo as assinaturas eletrônicas válidas nos termos da Medida Provisória nº 2.200-2/2001.",
      `Fica eleito o foro da Comarca de ${CONTRACTOR.forum} para dirimir dúvidas ou controvérsias oriundas deste contrato, com renúncia a qualquer outro, por mais privilegiado que seja.`,
      "E, por estarem de pleno acordo, as partes assinam o presente instrumento, física ou digitalmente, conferindo-lhe eficácia de título executivo extrajudicial.",
    ] },
  );
  return sections;
}

function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = safePdfText(text).split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) line = candidate;
    else { if (line) lines.push(line); line = word; }
  }
  if (line) lines.push(line);
  return lines;
}

export async function renderContractPdf(data: ContractData, contractNumber: string): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle("Contrato de Prestação de Serviços de Gestão de Milhas");
  pdf.setAuthor(CONTRACTOR.name);
  pdf.setCreator("MRL Travel - geração segura no servidor");
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const pageWidth = 595.28, pageHeight = 841.89, margin = 54, bodySize = 9.2, lineHeight = 13;
  let page: PDFPage;
  let y = 0;
  const newPage = () => { page = pdf.addPage([pageWidth, pageHeight]); y = pageHeight - margin; };
  const ensure = (height: number) => { if (y - height < margin + 20) newPage(); };
  const drawLines = (text: string, font: PDFFont, size: number, gap = lineHeight, indent = 0) => {
    const lines = wrap(text, font, size, pageWidth - margin * 2 - indent);
    ensure(lines.length * gap + 5);
    for (const line of lines) { page.drawText(line, { x: margin + indent, y, size, font, color: rgb(.12, .12, .12) }); y -= gap; }
    y -= 4;
  };
  newPage();
  const title = "CONTRATO DE PRESTAÇÃO DE SERVIÇOS DE GESTÃO DE MILHAS";
  page.drawText(title, { x: (pageWidth - bold.widthOfTextAtSize(title, 12.5)) / 2, y, size: 12.5, font: bold }); y -= 27;
  drawLines(`CONTRATADA: ${CONTRACTOR.name}, CNPJ nº ${CONTRACTOR.cnpj}, com sede em ${CONTRACTOR.address}, representada por ${CONTRACTOR.representative}.`, regular, bodySize);
  drawLines(`CONTRATANTE: ${data.nome}, brasileiro(a), ${valueOr(data.estado_civil).toLowerCase()}${data.profissao ? `, ${data.profissao}` : ""}, CPF ${valueOr(data.cpf)}, RG ${valueOr(data.rg)}, e-mail ${valueOr(data.email)}, residente em ${valueOr(data.endereco)}.`, regular, bodySize);
  contractSections(data).forEach((section, index) => {
    ensure(44);
    y -= 5;
    drawLines(`CLÁUSULA ${index + 1} - ${section.title}`, bold, 10.2, 14);
    section.paragraphs.forEach((paragraph) => drawLines(paragraph, regular, bodySize));
  });
  ensure(205); y -= 14;
  const date = new Date(`${data.data}T12:00:00Z`).toLocaleDateString("pt-BR", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  drawLines(`${data.cidade || "POMPÉU"}, ${date}.`, regular, bodySize);
  y -= 32; drawLines("_______________________________________________", regular, bodySize); drawLines(`CONTRATANTE: ${data.nome}`, regular, bodySize);
  y -= 22; drawLines("_______________________________________________", regular, bodySize); drawLines(`CONTRATADA: ${CONTRACTOR.representative}`, regular, bodySize);
  y -= 12; drawLines("TESTEMUNHAS:", bold, bodySize); drawLines("Nome: ___________________________  CPF: ___________________________", regular, bodySize); drawLines("Nome: ___________________________  CPF: ___________________________", regular, bodySize);
  const pages = pdf.getPages();
  pages.forEach((item, index) => item.drawText(`${contractNumber}  •  página ${index + 1} de ${pages.length}`, { x: margin, y: 25, size: 7, font: regular, color: rgb(.4, .4, .4) }));
  return pdf.save({ useObjectStreams: false });
}

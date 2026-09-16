import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "npm:pdf-lib@1.17.1";
import { LOGO_MRL_BASE64 } from "./logo-mrl-travel.ts";

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
  include_courtesy_ticket: boolean;
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
const numberWords: Record<number, string> = { 1:"um",2:"dois",3:"três",4:"quatro",5:"cinco",6:"seis",7:"sete",8:"oito",9:"nove",10:"dez",11:"onze",12:"doze",13:"treze",14:"quatorze",15:"quinze",16:"dezesseis",17:"dezessete",18:"dezoito",19:"dezenove",20:"vinte",30:"trinta",40:"quarenta",50:"cinquenta",60:"sessenta",70:"setenta",80:"oitenta",90:"noventa",100:"cem" };
const numberToWords = (value: number) => numberWords[value] ?? (value > 20 && value < 100 ? `${numberWords[Math.floor(value / 10) * 10]} e ${numberWords[value % 10]}` : String(value));
const percent = (value: number) => new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(value) + "%";
const percentageToWords = (value: number) => Number.isInteger(value) ? `${numberToWords(value)} por cento` : `${numberToWords(Math.trunc(value))} vírgula ${String(value).split(".")[1].split("").map((digit) => numberToWords(Number(digit))).join(" ")} por cento`;

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function contractSections(data: ContractData): Array<{ title: string; paragraphs: string[] }> {
  const payment = `A CONTRATANTE pagará à CONTRATADA o valor de R$ ${money(data.valor_total)}, por meio de Pix ou cartão de crédito, em parcelas até ${data.num_parcelas} (${numberToWords(data.num_parcelas)}) vezes de R$ ${money(data.valor_parcela)} via link de pagamento.`;
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
      "A CONTRATADA armazena os acessos fornecidos em ambiente seguro e criptografado, , com acesso restrito ao time autorizado e treinado.",
      "A CONTRATANTE reconhece que, embora raros, casos de invasão por terceiros (hackers) podem ocorrer. Nestes casos:",
      "• A CONTRATADA compromete-se a apurar os fatos com apoio jurídico;",
      "• A CONTRATADA não será responsabilizada por eventuais prejuízos decorrentes de ações externas alheias ao seu controle;",
      "• Não se presumirá culpa da CONTRATADA sem apuração técnica.",
      "Em caso de vazamento de dados por negligência da CONTRATADA, será aplicada multa de R$ 100.000,00 (cem mil reais), além de sanções legais cabíveis.",
    ] },
  ];
  if (data.include_courtesy_ticket) sections[0].paragraphs.push("• 1 Passagem cortesia para qualquer destino do Brasil IDA e VOLTA a solicitação da mesma deve ser feita com no mínimo 30 dias antes do embarque");
  if (data.incluir_cashback) sections.push({ title: "PROGRAMA DE CASHBACK POR VIAGENS CONTRATADAS", paragraphs: [
    `A CONTRATANTE fará jus a um benefício de cashback de ${percent(data.pct_cashback)} (${percentageToWords(data.pct_cashback)}) sobre o valor total de cada pacote ou serviço de viagem contratado diretamente através da MRL TRAVEL, nas seguintes hipóteses:`,
    "• Viagens corporativas custeadas ou reembolsadas pela empresa do(a) CONTRATANTE, desde que a contratação seja realizada por intermédio da CONTRATADA;",
    "• Viagens geradas por indicações feitas pelo(a) CONTRATANTE a terceiros, que resultem em contratação efetiva junto à CONTRATADA.",
    "Forma de apuração e utilização do cashback:",
    "• O cashback será apurado mensalmente pela CONTRATADA com base nos serviços efetivamente contratados e pagos no período;",
    "• O saldo acumulado poderá ser utilizado pelo(a) CONTRATANTE, a seu critério, nas seguintes modalidades: (a) crédito para abatimento em futuras contratações de viagens junto à MRL TRAVEL; ou (b) devolução em dinheiro via Pix, mediante solicitação expressa ao(à) CONTRATANTE;",
    "• A opção pela modalidade de utilização (crédito ou Pix) deverá ser comunicada pelo(a) CONTRATANTE por escrito (WhatsApp ou e-mail) até o último dia do mês de apuração. Na ausência de manifestação, o saldo será mantido como crédito automaticamente;",
    "• Quando optado pelo Pix, o pagamento será realizado pela CONTRATADA até o 10º dia útil do mês subsequente à apuração, para a chave Pix cadastrada pelo(a) CONTRATANTE;",
    "• O saldo em crédito será informado ao(à) CONTRATANTE por escrito (WhatsApp ou e-mail) até o 5º dia útil do mês subsequente à apuração;",
    "• Créditos não utilizados até o término do presente contrato poderão ser transferidos para eventual renovação ou convertidos em Pix, a critério do(a) CONTRATANTE mediante solicitação expressa.",
    "Exclusões:",
    "• Não incidirá cashback sobre serviços cancelados, estornados ou objetos de chargeback;",
    "• Indicações que não resultem em contratação efetiva e paga não geram direito a cashback;",
    "• O benefício de cashback não é cumulativo com outras promoções ou descontos concedidos pontualmente pela CONTRATADA, salvo acordo expresso em contrário.",
  ] });
  if (data.incluir_reembolso) sections.push({ title: "GARANTIA DE RETORNO DE INVESTIMENTO", paragraphs: [
    "• A CONTRATADA se compromete a gerar, no mínimo, o valor total investido pelo(a) CONTRATANTE em forma de descontos ou economias obtidas durante a gestão dos pontos/milhas em programas de fidelidades, conforme estipulado no presente contrato.",
    "• Reembolso da Diferença: Caso o(a) CONTRATANTE não obtenha o valor equivalente ao investimento inicial por meio dos referidos descontos ou economias até o término da prestação dos serviços, a CONTRATADA compromete-se a reembolsar ao(à) CONTRATANTE a diferença entre o valor investido e o valor efetivamente economizado ou obtido em forma de desconto.",
    "• Prazos e Condições: O reembolso da diferença deverá ser solicitado por escrito pelo(a) CONTRATANTE em até 15 dias após o término do contrato, apresentando a comprovação dos valores não atingidos, sendo o valor ressarcido pela CONTRATADA em até 30 dias após o recebimento da solicitação.",
    "• Exclusões: Esta garantia não será aplicável nos casos em que o não atingimento do valor investido decorra de falta de colaboração ou cumprimento das obrigações por parte do(a) CONTRATANTE, conforme previsto nas demais cláusulas do contrato.",
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
      "Este contrato poderá ser assinado física ou digitalmente, por meio de plataformas como Docusign, Clicksign ou similares, sendo as assinaturas eletrônicas consideradas válidas e eficazes, nos termos da Medida Provisória nº 2.200-2/2001, com valor jurídico equivalente ao da assinatura física.",
      `Fica eleito o foro da Comarca de ${CONTRACTOR.forum} para dirimir quaisquer dúvidas ou controvérsias oriundas deste contrato, com renúncia a qualquer outro, por mais privilegiado que seja.`,
      "E, por estarem de pleno acordo, as partes assinam o presente instrumento, física ou digitalmente, conferindo-lhe eficácia de título executivo extrajudicial.\"",
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

export async function renderContractPdf(data: ContractData, _contractNumber: string): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle("Contrato de Prestação de Serviços de Gestão de Milhas");
  pdf.setAuthor(CONTRACTOR.name);
  pdf.setCreator("MRL Travel - geração segura no servidor");
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const pageWidth = 595.28, pageHeight = 841.89, margin = 74, bodySize = 10.5, lineHeight = 15.2;
  let page: PDFPage;
  let y = 0;
  const newPage = () => { page = pdf.addPage([pageWidth, pageHeight]); y = pageHeight - margin; };
  const ensure = (height: number) => { if (y - height < margin) newPage(); };
  const drawLines = (text: string, font: PDFFont, size: number, gap = lineHeight, indent = 0, after = 8) => {
    const lines = wrap(text, font, size, pageWidth - margin * 2 - indent);
    ensure(lines.length * gap + after);
    for (const line of lines) { page.drawText(line, { x: margin + indent, y, size, font, color: rgb(.06, .06, .06) }); y -= gap; }
    y -= after;
  };
  const drawRichLines = (parts: Array<{ text: string; font: PDFFont }>, after = 10) => {
    const maxWidth = pageWidth - margin * 2;
    const spaceWidth = regular.widthOfTextAtSize(" ", bodySize);
    const words = parts.flatMap((part) => safePdfText(part.text).trim().split(/\s+/).filter(Boolean).map((text) => ({ text, font: part.font })));
    const lines: Array<typeof words> = []; let current: typeof words = []; let width = 0;
    for (const word of words) {
      const wordWidth = word.font.widthOfTextAtSize(word.text, bodySize);
      if (current.length && width + spaceWidth + wordWidth > maxWidth) { lines.push(current); current = []; width = 0; }
      current.push(word); width += (current.length > 1 ? spaceWidth : 0) + wordWidth;
    }
    if (current.length) lines.push(current);
    ensure(lines.length * lineHeight + after);
    for (const line of lines) {
      let x = margin;
      line.forEach((word, index) => { if (index) x += spaceWidth; page.drawText(word.text, { x, y, size: bodySize, font: word.font, color: rgb(.06,.06,.06) }); x += word.font.widthOfTextAtSize(word.text, bodySize); });
      y -= lineHeight;
    }
    y -= after;
  };
  newPage();
  try {
    const logo = await pdf.embedPng(decodeBase64(LOGO_MRL_BASE64));
    const logoWidth = 100;
    const logoHeight = logoWidth * logo.height / logo.width;
    page.drawImage(logo, { x: (pageWidth - logoWidth) / 2, y: y - logoHeight + 18, width: logoWidth, height: logoHeight });
    y -= logoHeight + 8;
  } catch (error) {
    console.warn("[generate-client-contract] logo indisponível; contrato será gerado sem logo", error instanceof Error ? error.message : "unknown");
  }
  const title = "CONTRATO DE PRESTAÇÃO DE SERVIÇOS DE GESTÃO DE MILHAS";
  page.drawText(title, { x: (pageWidth - bold.widthOfTextAtSize(title, 11.5)) / 2, y, size: 11.5, font: bold }); y -= 28;
  drawLines("PARTES:", bold, bodySize, lineHeight, 0, 12);
  drawRichLines([{ text:"De um lado,",font:regular },{ text:"MRL TRAVEL,",font:bold },{ text:"inscrita no CNPJ sob o nº",font:regular },{ text:`${CONTRACTOR.cnpj},`,font:bold },{ text:`com sede em ${CONTRACTOR.address}, neste ato representada por`,font:regular },{ text:`${CONTRACTOR.representative},`,font:bold },{ text:"doravante denominada",font:regular },{ text:"CONTRATADA;",font:bold }], 13);
  drawRichLines([{ text:"De outro lado, Sr(a).",font:regular },{ text:`${data.nome},`,font:bold },{ text:"brasileiro(a),",font:regular },{ text:`${valueOr(data.estado_civil)},`,font:bold },{ text:`${valueOr(data.profissao)},`,font:bold },{ text:"inscrito no CPF:",font:regular },{ text:`${valueOr(data.cpf)},`,font:bold },{ text:"portador do RG",font:regular },{ text:`${valueOr(data.rg)},`,font:bold },{ text:"residente e domiciliado em",font:regular },{ text:`${valueOr(data.endereco)};`,font:bold },{ text:"doravante denominado(a)",font:regular },{ text:"CONTRATANTE.",font:bold }], 14);
  contractSections(data).forEach((section, index) => {
    ensure(48); y -= 3;
    drawLines(`CLÁUSULA ${index + 1} - ${section.title}`, bold, 10.5, lineHeight, 0, 12);
    section.paragraphs.forEach((paragraph, blockIndex) => {
      if (index === 0 && blockIndex === 1) { page.drawLine({ start: { x: margin, y: y + 3 }, end: { x: pageWidth - margin, y: y + 3 }, thickness: .65, color: rgb(.48,.48,.48) }); y -= 15; }
      if (paragraph.startsWith("• ")) drawLines(paragraph, regular, bodySize, lineHeight, 18, 9);
      else drawLines(paragraph, regular, bodySize, lineHeight, 0, 10);
    });
    if (index === 0) { ensure(18); page.drawLine({ start: { x: margin, y: y + 5 }, end: { x: pageWidth - margin, y: y + 5 }, thickness: .65, color: rgb(.48,.48,.48) }); y -= 13; }
  });
  ensure(300); y -= 25;
  const date = new Date(`${data.data}T12:00:00Z`).toLocaleDateString("pt-BR", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).toUpperCase();
  drawLines(`${data.cidade || "POMPÉU"}, ${date}`, regular, bodySize, lineHeight, 0, 34);
  y -= 35; page.drawLine({ start:{ x:182,y },end:{ x:413,y },thickness:.7,color:rgb(.12,.12,.12) }); y -= 17; drawLines(`CONTRATANTE: ${data.nome}`, regular, bodySize, lineHeight, 92, 34);
  page.drawLine({ start:{ x:182,y },end:{ x:413,y },thickness:.7,color:rgb(.12,.12,.12) }); y -= 17; drawLines(`CONTRATADA: ${CONTRACTOR.representative}`, regular, bodySize, lineHeight, 54, 38);
  drawLines("TESTEMUNHAS:", bold, bodySize, lineHeight, 0, 24);
  drawLines("Nome: ___________________________  CPF: 124.674.296-95", regular, bodySize, lineHeight, 70, 22);
  drawLines("Nome: ___________________________  CPF: 157.386.726.82", regular, bodySize, lineHeight, 70, 0);
  return pdf.save({ useObjectStreams: false });
}

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { analyzeNotionFiles, detectDelimiter, extractNotionPageId, parseCsv, parsePointQuantity, sanitizeMarkdown, summarizeAnalysis, type SourceFile } from "../../supabase/functions/_shared/notion-import";

describe("notion_mrl_v2 parser", () => {
  it("processa UTF-8-BOM, ponto e vírgula, aspas e multiline RFC 4180", () => {
    const csv = '\uFEFFTítulo;Cliente;Comentários;Concluído em;Criado em;Prazo;Responsável;Status;Tempo gasto;Tipo;Urgência;Última edição\r\n"Cotação";;"linha 1\nlinha 2";;;;;"Não iniciada";;Outros;;';
    expect(detectDelimiter(csv)).toBe(";");
    const parsed = parseCsv(csv);
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0].Comentários).toBe("linha 1\nlinha 2");
  });

  it("extrai Page ID de URL, caminho codificado e filename", () => {
    const id = "25339091399e8072a203c0cdc941e3af";
    expect(extractNotionPageId(`https://app.notion.com/p/titulo-${id}?pvs=21`)).toBe(id);
    expect(extractNotionPageId(`Cliente%20${id}.md`)).toBe(id);
    expect(extractNotionPageId(`Cliente ${id}.md`)).toBe(id);
  });

  it("não adivinha quantidade ambígua de pontos", () => {
    expect(parsePointQuantity("24.097")).toEqual({ value: 24097, ambiguous: false });
    expect(parsePointQuantity("13,324")).toEqual({ value: 13324, ambiguous: false });
    expect(parsePointQuantity("150,15")).toEqual({ value: null, ambiguous: true });
  });

  it("sanitiza Markdown e preserva checklist como texto", () => {
    const result = sanitizeMarkdown('# Título\n- [ ] Conferir <script>alert(1)</script>\n[Site](https://example.com)');
    expect(result.text).not.toContain("<script>");
    expect(result.text).toContain("Site (https://example.com)");
    expect(result.checklist).toEqual(["Conferir alert(1)"]);
  });

  it("ignora visão relacional quando a base canônica equivalente existe", () => {
    const header = "Título,Cliente,Comentários,Concluído em,Criado em,Prazo,Responsável,Status,Tempo gasto,Tipo,Urgência,Última edição\n";
    const row = 'Teste,,,,,,,"Não iniciada",,Outros,,\n';
    const result = analyzeNotionFiles([{ path: "Demandas_all.csv", content: header + row }, { path: "cliente/Demandas.csv", content: header + row }]);
    expect(result.find((file) => file.path.includes("cliente/"))?.ignoredReason).toBe("FILTERED_RELATIONAL_VIEW");
  });

  it("normaliza saldo, custo e validade de programa sem escrever no ledger", () => {
    const clientId = "25339091399e8072a203c0cdc941e3af";
    const csv = "Programa,Cliente,Custo milheiro,Data da expiração,Pontos a expirar,Programas,Saldo atual,Última edição\n" +
      `Esfera - ,Cliente ${clientId}.md,25.50,7 de agosto de 2027 14:39,1.000,Esfera,38.500,20 de julho de 2026 10:00\n`;
    const [file] = analyzeNotionFiles([{ path: "Programas_all.csv", content: csv }]);
    expect(file.rows[0]).toMatchObject({ entityType: "program", resolutionStatus: "pending_decision", normalizedPayload: { programName: "Esfera", importedPoints: 38500, costPerThousand: 25.5, expiringPoints: 1000, expiresOn: "2027-08-07" } });
  });
});

const realZipPath = process.env.MRL_NOTION_ZIP ?? String.raw`C:\Users\GESTAO\Desktop\f3152da7-5364-4a91-8b55-e65986ddebbf_ExportBlock-b919e00c-95ea-48a6-ac8b-41a28215e846.zip`.replaceAll("\\\\", "\\");
const extractedDir = process.env.MRL_NOTION_EXTRACTED_DIR ?? String.raw`C:\Users\GESTAO\AppData\Local\Temp\mrl_patch016_d420eabbd1c24b39a7f220505887f7c4\inner`.replaceAll("\\\\", "\\");
const realZipTest = existsSync(realZipPath) || existsSync(extractedDir) ? it : it.skip;

describe("ZIP real do Notion", () => {
  realZipTest("produz as contagens canônicas e conflitos de referência", async () => {
    const files = existsSync(realZipPath) ? await extractTextFiles(new Uint8Array(readFileSync(realZipPath))) : readExtractedTextFiles(extractedDir);
    const summary = summarizeAnalysis(analyzeNotionFiles(files));
    expect(summary.canonical).toEqual({ clients: 21, tasks: 41, programs: 56, onboardings: 9, passages: 1 });
    expect(summary.taskRelations).toEqual({ linked: 28, needsDecision: 13 });
    expect(summary.officialBalancesCreatedByDefault).toBe(0);
    expect(summary.ignoredFilteredFiles).toBe(35);
  });
});

async function extractTextFiles(bytes: Uint8Array, depth = 0): Promise<SourceFile[]> {
  const zip = await JSZip.loadAsync(bytes);
  const output: SourceFile[] = [];
  for (const entry of Object.values(zip.files)) {
    if (entry.dir) continue;
    if (entry.name.toLowerCase().endsWith(".zip")) {
      if (depth >= 1) throw new Error("nested zip beyond supported depth");
      output.push(...await extractTextFiles(await entry.async("uint8array"), depth + 1));
    } else if (/\.(csv|md)$/i.test(entry.name)) output.push({ path: entry.name, content: await entry.async("string") });
  }
  return output;
}

function readExtractedTextFiles(root: string, current = root): SourceFile[] {
  return readdirSync(current, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = join(current, entry.name);
    if (entry.isDirectory()) return readExtractedTextFiles(root, fullPath);
    if (!/\.(csv|md)$/i.test(entry.name)) return [];
    return [{ path: fullPath.slice(root.length + 1).replace(/\\/g, "/"), content: readFileSync(fullPath, "utf8") }];
  });
}

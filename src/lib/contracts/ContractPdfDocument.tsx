import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import { formatContractDateLong } from "./contractFormat";
import { buildContractClauses, CONTRACTOR } from "./contractText";
import type { ContractDraft } from "@/types/contracts";

const styles = StyleSheet.create({
  page: { paddingTop: 52, paddingBottom: 54, paddingHorizontal: 56, fontFamily: "Helvetica", fontSize: 9.5, lineHeight: 1.45, color: "#202020" },
  title: { marginBottom: 17, fontFamily: "Helvetica-Bold", fontSize: 13, lineHeight: 1.3, textAlign: "center" },
  sectionLabel: { marginBottom: 6, fontFamily: "Helvetica-Bold" },
  paragraph: { marginBottom: 5, textAlign: "justify" },
  clause: { marginTop: 10, marginBottom: 5, fontFamily: "Helvetica-Bold", fontSize: 10.5 },
  bulletRow: { flexDirection: "row", marginBottom: 4, paddingLeft: 14 },
  bullet: { width: 12 },
  bulletText: { flex: 1, textAlign: "justify" },
  signatureDate: { marginTop: 22, marginBottom: 42, textAlign: "center" },
  signatureBlock: { marginBottom: 34, textAlign: "center" },
  signatureLine: { marginBottom: 4, textAlign: "center" },
  witnessesTitle: { marginTop: 6, marginBottom: 22, fontFamily: "Helvetica-Bold" },
  witness: { marginBottom: 25 },
  footerLabel: { position: "absolute", left: 56, bottom: 24, color: "#777", fontSize: 7.5 },
});

function valueOrBlank(value: string, fallback = "não informado"): string {
  return value.trim() || fallback;
}

export function ContractPdfDocument({ draft, contractNumber }: { draft: ContractDraft; contractNumber?: string | null }) {
  const clauses = buildContractClauses(draft);
  const civil = valueOrBlank(draft.maritalStatus).toLowerCase();
  const profession = draft.profession.trim() ? ", " + draft.profession.trim() : "";

  return (
    <Document title="Contrato de Prestação de Serviços de Gestão de Milhas" author={CONTRACTOR.name}>
      <Page size="A4" style={styles.page} wrap>
        <Text style={styles.title}>CONTRATO DE PRESTAÇÃO DE SERVIÇOS DE GESTÃO DE MILHAS</Text>
        <Text style={styles.sectionLabel}>PARTES:</Text>
        <Text style={styles.paragraph}>
          De um lado, <Text style={styles.sectionLabel}>{CONTRACTOR.name}</Text>, inscrita no CNPJ sob o nº {CONTRACTOR.cnpj}, com sede em {CONTRACTOR.address}, neste ato representada por {CONTRACTOR.representative}, doravante denominada CONTRATADA;
        </Text>
        <Text style={styles.paragraph}>
          De outro lado, Sr(a). <Text style={styles.sectionLabel}>{draft.clientName}</Text>, brasileiro(a), {civil}{profession}, inscrito(a) no CPF: {valueOrBlank(draft.cpf)}, portador(a) do RG {valueOrBlank(draft.rg)}, e-mail {valueOrBlank(draft.email)}, residente e domiciliado(a) em {valueOrBlank(draft.fullAddress)}; doravante denominado(a) CONTRATANTE.
        </Text>

        {clauses.map((clause) => (
          <View key={clause.number} wrap>
            <Text style={styles.clause}>CLÁUSULA {clause.number} - {clause.title}</Text>
            {clause.blocks.map((block, index) => block.type === "paragraph" ? (
              <Text key={index} style={styles.paragraph}>{block.text}</Text>
            ) : (
              <View key={index} style={styles.bulletRow}>
                <Text style={styles.bullet}>•</Text>
                <Text style={styles.bulletText}>{block.text}</Text>
              </View>
            ))}
          </View>
        ))}

        <Text style={styles.signatureDate}>{draft.signatureCity || CONTRACTOR.defaultCity}, {formatContractDateLong(draft.contractDate)}</Text>
        <View style={styles.signatureBlock} wrap={false}>
          <Text style={styles.signatureLine}>_______________________________________________</Text>
          <Text>CONTRATANTE: {draft.clientName}</Text>
        </View>
        <View style={styles.signatureBlock} wrap={false}>
          <Text style={styles.signatureLine}>_______________________________________________</Text>
          <Text>CONTRATADA: {CONTRACTOR.representative}</Text>
        </View>
        <Text style={styles.witnessesTitle}>TESTEMUNHAS:</Text>
        <Text style={styles.witness}>Nome: ___________________________ CPF: {CONTRACTOR.witnessOneCpf}</Text>
        <Text style={styles.witness}>Nome: ___________________________ CPF: {CONTRACTOR.witnessTwoCpf}</Text>
        <Text style={styles.footerLabel} fixed>{contractNumber ? "Contrato " + contractNumber : CONTRACTOR.name}</Text>
      </Page>
    </Document>
  );
}

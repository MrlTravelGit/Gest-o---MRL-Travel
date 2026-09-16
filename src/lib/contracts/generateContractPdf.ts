import { pdf } from "@react-pdf/renderer";
import { createElement } from "react";
import { ContractPdfDocument } from "./ContractPdfDocument";
import type { ContractDraft } from "@/types/contracts";

export async function generateContractPdf(draft: ContractDraft, contractNumber?: string | null): Promise<Blob> {
  const document = createElement(ContractPdfDocument, { draft, contractNumber }) as unknown as Parameters<typeof pdf>[0];
  return pdf(document).toBlob();
}

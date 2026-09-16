export type ContractStatus = "generated" | "archived";

export interface ContractPartyData {
  clientId: string;
  clientName: string;
  cpf: string;
  rg: string;
  email: string;
  maritalStatus: string;
  profession: string;
  fullAddress: string;
}

export interface ContractCommercialData {
  contractValue: number;
  installments: number;
  installmentValue: number;
  signatureCity: string;
  contractDate: string;
  includeCashback: boolean;
  cashbackPercent: number;
  includeRoiGuarantee: boolean;
}

export type ContractDraft = ContractPartyData & ContractCommercialData;

export interface ClientContract extends ContractDraft {
  id: string;
  contractNumber: string | null;
  status: ContractStatus;
  pdfPath: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

export type ContractFilter = "active" | "archived" | "all";

export type ContractStatus = "generated" | "archived";
export type ContractSignatureStatus = "draft" | "sent" | "pending_signature" | "partially_signed" | "completed" | "rejected" | "failed";
export type ContractSignerStatus = "pending" | "viewed" | "signed" | "rejected" | "failed";

export interface ContractSignatureSigner {
  id: string;
  providerPublicId: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  action: string;
  deliveryMethod: string | null;
  signatureLink: string | null;
  status: ContractSignerStatus;
  signedAt: string | null;
  viewedAt: string | null;
  rejectedAt: string | null;
}

export interface ContractSignatureRequest {
  id: string;
  providerDocumentId: string | null;
  providerDocumentName: string | null;
  status: ContractSignatureStatus;
  sandbox: boolean;
  signedPdfUrl: string | null;
  padesPdfUrl: string | null;
  errorMessage: string | null;
  productionMonthKey: string | null;
  approvedAt: string | null;
  customerNotifiedAt: string | null;
  customerNotificationStatus: "sending" | "sent" | "pending_manual" | "failed" | null;
  customerNotificationError: string | null;
  createdAt: string;
  updatedAt: string;
  signers: ContractSignatureSigner[];
}

export interface AutentiqueSendContext {
  sandbox: boolean;
  witnesses: Array<{ name: string; email: string }>;
  witnessesConfigured: boolean;
  productionMonthKey: string;
  productionUsed: number;
  monthlyLimit: number;
  canOverrideMonthlyLimit: boolean;
}

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
  includeCourtesyTicket: boolean;
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
  signatureRequest: ContractSignatureRequest | null;
}

export type ContractFilter = "active" | "archived" | "all";

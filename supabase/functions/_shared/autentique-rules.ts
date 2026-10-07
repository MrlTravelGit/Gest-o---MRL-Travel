export type WitnessConfig = { name: string; email: string };
export type ContractorSignerConfig = { name: string; email: string };
export type SignerRole = "client_signer" | "contractor_signer" | "witness";
export type BasicSigner = { name: string; email?: string; phone?: string; cpf?: string; action?: string; deliveryMethod?: "link" | "email" | "whatsapp" | "sms" };
export type PreparedSigner = Omit<BasicSigner, "action"> & { action: string; signerRole: SignerRole };

export function parseDefaultWitnesses(raw?: string | null): WitnessConfig[] {
  if (!raw?.trim()) return [];
  try {
    const value = JSON.parse(raw) as unknown;
    if (!Array.isArray(value)) return [];
    const seen = new Set<string>();
    return value.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const row = item as Record<string, unknown>;
      const name = String(row.name ?? "").trim();
      const email = String(row.email ?? "").trim().toLowerCase();
      if (name.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || seen.has(email)) return [];
      seen.add(email);
      return [{ name, email }];
    });
  } catch { return []; }
}

export function parseContractorSigner(raw?: string | null): ContractorSignerConfig | null {
  if (!raw?.trim()) return null;
  const parsed = parseDefaultWitnesses(`[${raw}]`);
  return parsed.length === 1 ? parsed[0] : null;
}

export function buildAutentiqueSigners(primary: BasicSigner[], contractor: ContractorSignerConfig | null, witnesses: WitnessConfig[], excludedWitnessEmails: string[]): PreparedSigner[] {
  const excluded = new Set(excludedWitnessEmails.map((email) => email.toLowerCase()));
  const primaryEmails = new Set(primary.flatMap((signer) => signer.email ? [signer.email.toLowerCase()] : []));
  const primaryNames = new Set(primary.map((signer) => signer.name.trim().toLocaleLowerCase("pt-BR")));
  const contractorEmail = contractor?.email.toLowerCase();
  const contractorName = contractor?.name.trim().toLocaleLowerCase("pt-BR");
  const includeContractor = contractor && !primaryEmails.has(contractorEmail!) && !primaryNames.has(contractorName!);
  return [
    ...primary.map((signer) => {
      const isContractor = Boolean(contractor && (
        (signer.email && signer.email.toLowerCase() === contractorEmail)
        || signer.name.trim().toLocaleLowerCase("pt-BR") === contractorName
      ));
      return { ...signer, action: "SIGN", signerRole: isContractor ? "contractor_signer" as const : "client_signer" as const };
    }),
    ...(includeContractor ? [{ ...contractor, phone: "", cpf: "", action: "SIGN", deliveryMethod: "email" as const, signerRole: "contractor_signer" as const }] : []),
    ...witnesses.filter((witness) => {
      const email = witness.email.toLowerCase();
      return !excluded.has(email) && !primaryEmails.has(email) && email !== contractorEmail;
    }).map((witness) => ({
      ...witness, phone: "", cpf: "", action: "SIGN_AS_A_WITNESS", deliveryMethod: "email" as const, signerRole: "witness" as const,
    })),
  ];
}

export function isMonthlySendBlocked(input: { sandbox: boolean; used: number; limit: number; override: boolean; superAdmin: boolean }): boolean {
  return !input.sandbox && input.used >= input.limit && !(input.override && input.superAdmin);
}

export function webhookTransition(type: string, alreadyApproved = false): { signer?: "signed" | "rejected" | "failed"; contract?: "completed" | "rejected"; approve: boolean; notify: boolean } {
  if (type === "document.finished") return { contract: "completed", approve: true, notify: !alreadyApproved };
  if (type === "signature.accepted") return { signer: "signed", approve: false, notify: false };
  if (type === "signature.rejected") return { signer: "rejected", contract: alreadyApproved ? undefined : "rejected", approve: false, notify: false };
  if (type === "signature.delivery_failed") return { signer: "failed", approve: false, notify: false };
  return { approve: false, notify: false };
}

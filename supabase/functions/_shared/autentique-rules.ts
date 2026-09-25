export type WitnessConfig = { name: string; email: string };
export type BasicSigner = { name: string; email?: string; phone?: string; cpf?: string; action?: string; deliveryMethod?: "link" | "email" | "whatsapp" | "sms" };
export type PreparedSigner = Omit<BasicSigner, "action"> & { action: string };

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

export function buildAutentiqueSigners(primary: BasicSigner[], witnesses: WitnessConfig[], excludedWitnessEmails: string[]): PreparedSigner[] {
  const excluded = new Set(excludedWitnessEmails.map((email) => email.toLowerCase()));
  const primaryEmails = new Set(primary.flatMap((signer) => signer.email ? [signer.email.toLowerCase()] : []));
  return [
    ...primary.map((signer) => ({ ...signer, action: "SIGN" })),
    ...witnesses.filter((witness) => !excluded.has(witness.email) && !primaryEmails.has(witness.email)).map((witness) => ({
      ...witness, phone: "", cpf: "", action: "SIGN_AS_A_WITNESS", deliveryMethod: "email" as const,
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

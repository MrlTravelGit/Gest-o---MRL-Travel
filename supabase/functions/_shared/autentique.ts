import type { SupabaseClient } from "npm:@supabase/supabase-js@2.93.3";

const API_URL = "https://api.autentique.com.br/v2/graphql";

export type AutentiqueSignerInput = {
  name: string;
  email?: string;
  phone?: string;
  cpf?: string;
  action: string;
  deliveryMethod?: "link" | "email" | "whatsapp" | "sms";
};

type AutentiqueSignature = {
  public_id?: string | null;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  link?: { short_link?: string | null } | null;
  user?: { name?: string | null; email?: string | null; phone?: string | null } | null;
  user_data?: { name?: string | null; email?: string | null; phone?: string | null } | null;
  viewed?: { created_at?: string | null } | string | null;
  signed?: { created_at?: string | null } | string | null;
  rejected?: { created_at?: string | null } | string | null;
  [key: string]: unknown;
};

export type AutentiqueDocument = {
  id: string;
  name?: string | null;
  sandbox?: boolean | number | null;
  signatures_count?: number | null;
  signed_count?: number | null;
  rejected_count?: number | null;
  signatures?: AutentiqueSignature[] | null;
  files?: { original?: string | null; signed?: string | null; pades?: string | null } | null;
  [key: string]: unknown;
};

function requiredToken(): string {
  const token = Deno.env.get("AUTENTIQUE_API_TOKEN")?.trim();
  if (!token) throw new Error("AUTENTIQUE_NOT_CONFIGURED");
  return token;
}

export function autentiqueSandbox(): boolean {
  return (Deno.env.get("AUTENTIQUE_SANDBOX") ?? "true").toLowerCase() !== "false";
}

function scopeArguments(): string {
  const args: string[] = [];
  const organizationId = Deno.env.get("AUTENTIQUE_ORGANIZATION_ID")?.trim();
  const folderId = Deno.env.get("AUTENTIQUE_FOLDER_ID")?.trim();
  if (organizationId) {
    if (!/^\d+$/.test(organizationId)) throw new Error("AUTENTIQUE_ORGANIZATION_INVALID");
    args.push(`organization_id: ${organizationId}`);
  }
  if (folderId) args.push(`folder_id: ${JSON.stringify(folderId)}`);
  return args.length ? `, ${args.join(", ")}` : "";
}

function signerPayload(signer: AutentiqueSignerInput): Record<string, unknown> {
  const method = signer.deliveryMethod ?? "link";
  const payload: Record<string, unknown> = { action: signer.action || "SIGN" };
  if (method === "email") {
    payload.email = signer.email;
  } else {
    payload.name = signer.name;
    if (signer.email) payload.email = signer.email;
    if (signer.phone) payload.phone = signer.phone;
    payload.delivery_method = method === "whatsapp"
      ? "DELIVERY_METHOD_WHATSAPP"
      : method === "sms"
      ? "DELIVERY_METHOD_SMS"
      : "DELIVERY_METHOD_LINK";
  }
  if (signer.cpf) payload.configs = { cpf: signer.cpf.replace(/\D/g, "") };
  return payload;
}

async function parseGraphqlResponse(response: Response): Promise<Record<string, unknown>> {
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new Error(response.status === 413 ? "AUTENTIQUE_FILE_TOO_LARGE" : "AUTENTIQUE_API_FAILED");
  const errors = Array.isArray(body.errors) ? body.errors : [];
  if (errors.length) {
    console.error("Autentique GraphQL error", JSON.stringify(errors).slice(0, 1500));
    throw new Error("AUTENTIQUE_API_FAILED");
  }
  return body;
}

async function uploadDocument(
  pdf: Blob,
  fileName: string,
  document: Record<string, unknown>,
  signers: AutentiqueSignerInput[],
): Promise<AutentiqueDocument> {
  const sandboxArgument = autentiqueSandbox() ? "sandbox: true," : "";
  const query = `mutation CreateDocumentMutation($document: DocumentInput!, $signers: [SignerInput!]!, $file: Upload!) {
    createDocument(${sandboxArgument} document: $document, signers: $signers, file: $file${scopeArguments()}) {
      id name refusable sortable created_at
      signatures { public_id name email created_at action { name } link { short_link } user { id name email phone } }
    }
  }`;
  const form = new FormData();
  form.append("operations", JSON.stringify({
    query,
    variables: { document, signers: signers.map(signerPayload), file: null },
  }));
  form.append("map", JSON.stringify({ file: ["variables.file"] }));
  form.append("file", pdf, fileName);
  const response = await fetch(API_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${requiredToken()}` },
    body: form,
  });
  const parsed = await parseGraphqlResponse(response);
  const created = (parsed.data as { createDocument?: AutentiqueDocument } | undefined)?.createDocument;
  if (!created?.id) throw new Error("AUTENTIQUE_API_FAILED");
  return created;
}

export async function createAutentiqueDocument(pdf: Blob, fileName: string, documentName: string, signers: AutentiqueSignerInput[]): Promise<AutentiqueDocument> {
  try {
    return await uploadDocument(pdf, fileName, {
      name: documentName,
      refusable: true,
      sortable: false,
      ignore_cpf: false,
      stop_on_rejected: true,
      locale: { country: "BR", language: "pt-BR", timezone: "America/Sao_Paulo", date_format: "DD_MM_YYYY" },
    }, signers);
  } catch (error) {
    if (!(error instanceof Error) || error.message !== "AUTENTIQUE_API_FAILED") throw error;
    return uploadDocument(pdf, fileName, { name: documentName }, signers);
  }
}

export async function fetchAutentiqueDocument(documentId: string): Promise<AutentiqueDocument> {
  const query = `query DocumentStatus {
    document(id: ${JSON.stringify(documentId)}) {
      id name
      files { original signed pades }
      signatures {
        public_id name email link { short_link }
        user { id name email phone }
        user_data { name email phone }
        viewed { created_at } signed { created_at } rejected { created_at }
      }
    }
  }`;
  const response = await fetch(API_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${requiredToken()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const parsed = await parseGraphqlResponse(response);
  const document = (parsed.data as { document?: AutentiqueDocument } | undefined)?.document;
  if (!document?.id) throw new Error("AUTENTIQUE_DOCUMENT_NOT_FOUND");
  return document;
}

function eventDate(value: AutentiqueSignature["signed"]): string | null {
  if (typeof value === "string") return value;
  return value?.created_at ?? null;
}

export function inferAutentiqueStatus(document: AutentiqueDocument): "pending_signature" | "partially_signed" | "completed" | "rejected" {
  const signatures = document.signatures ?? [];
  const rejected = Number(document.rejected_count ?? 0) || signatures.filter((item) => eventDate(item.rejected)).length;
  const signed = Number(document.signed_count ?? 0) || signatures.filter((item) => eventDate(item.signed)).length;
  const total = Number(document.signatures_count ?? 0) || signatures.length;
  if (rejected > 0) return "rejected";
  if (total > 0 && signed >= total) return "completed";
  if (signed > 0) return "partially_signed";
  return "pending_signature";
}

function normalized(value: unknown): string {
  return String(value ?? "").trim().toLocaleLowerCase("pt-BR");
}

export async function persistAutentiqueDocument(
  admin: SupabaseClient,
  requestId: string,
  document: AutentiqueDocument,
  webhookPayload?: unknown,
): Promise<void> {
  const requestUpdate: Record<string, unknown> = {
    provider_document_id: document.id,
    provider_document_name: document.name ?? null,
    status: inferAutentiqueStatus(document),
    signed_pdf_url: document.files?.signed ?? null,
    pades_pdf_url: document.files?.pades ?? null,
    error_message: null,
  };
  if (webhookPayload !== undefined) requestUpdate.last_webhook_payload = webhookPayload;
  const updated = await admin.from("contract_signature_requests").update(requestUpdate).eq("id", requestId);
  if (updated.error) throw updated.error;

  const existingResult = await admin.from("contract_signature_signers").select("id,name,email,provider_public_id").eq("signature_request_id", requestId);
  if (existingResult.error) throw existingResult.error;
  const existing = existingResult.data ?? [];
  for (const signature of document.signatures ?? []) {
    const publicId = signature.public_id ?? null;
    const signatureName = signature.name ?? signature.user_data?.name ?? signature.user?.name ?? "Signatário";
    const signatureEmail = signature.email ?? signature.user_data?.email ?? signature.user?.email ?? null;
    const match = existing.find((row) =>
      (publicId && row.provider_public_id === publicId)
      || (signatureEmail && normalized(row.email) === normalized(signatureEmail))
      || normalized(row.name) === normalized(signatureName)
    );
    const signedAt = eventDate(signature.signed);
    const rejectedAt = eventDate(signature.rejected);
    const viewedAt = eventDate(signature.viewed);
    const status = rejectedAt ? "rejected" : signedAt ? "signed" : viewedAt ? "viewed" : "pending";
    const values = {
      provider_public_id: publicId,
      name: signatureName,
      email: signatureEmail,
      phone: signature.phone ?? signature.user_data?.phone ?? signature.user?.phone ?? null,
      signature_link: signature.link?.short_link ?? null,
      status,
      signed_at: signedAt,
      viewed_at: viewedAt,
      rejected_at: rejectedAt,
      raw_signature: signature,
    };
    const result = match
      ? await admin.from("contract_signature_signers").update(values).eq("id", match.id)
      : await admin.from("contract_signature_signers").insert({ signature_request_id: requestId, action: "SIGN", ...values });
    if (result.error) throw result.error;
  }
}

export async function verifyAutentiqueWebhook(rawBody: string, signature: string | null, secret: string): Promise<boolean> {
  if (!signature || !/^[a-f0-9]{64}$/i.test(signature)) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody)));
  const expected = Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) difference |= expected.charCodeAt(index) ^ signature.toLowerCase().charCodeAt(index);
  return difference === 0;
}

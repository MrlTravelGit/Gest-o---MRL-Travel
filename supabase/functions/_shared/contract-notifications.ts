import type { SupabaseClient } from "npm:@supabase/supabase-js@2.93.3";

type ApprovedMessageInput = {
  requestId: string;
  clientId: string;
  contractId: string;
  customerName: string;
  customerPhone: string | null;
  customerEmail: string | null;
  signedPdfUrl: string | null;
  force?: boolean;
};

type NotificationOutcome = { status: "sent" | "pending_manual" | "failed"; error?: string };

function maskRecipient(value: string | null): string {
  if (!value) return "não informado";
  if (value.includes("@")) {
    const [local, domain] = value.split("@");
    return `${local.slice(0, 2)}***@${domain}`;
  }
  return `${value.slice(0, 5)}*****${value.slice(-2)}`;
}

async function mark(admin: SupabaseClient, requestId: string, outcome: NotificationOutcome): Promise<void> {
  const update = await admin.from("contract_signature_requests").update({
    customer_notification_status: outcome.status,
    customer_notification_error: outcome.error ?? null,
    customer_notified_at: outcome.status === "sent" ? new Date().toISOString() : null,
  }).eq("id", requestId);
  if (update.error) throw update.error;
}

export async function sendCustomerContractApprovedMessage(admin: SupabaseClient, input: ApprovedMessageInput): Promise<NotificationOutcome> {
  const claimQuery = admin.from("contract_signature_requests")
    .update({ customer_notification_status: "sending", customer_notification_error: null })
    .eq("id", input.requestId)
    .is("customer_notified_at", null);
  const claim = input.force
    ? await claimQuery.select("id").maybeSingle()
    : await claimQuery.or("customer_notification_status.is.null,customer_notification_status.eq.failed").select("id").maybeSingle();
  if (claim.error) throw claim.error;
  if (!claim.data) return { status: "pending_manual" };

  const message = `Olá, ${input.customerName}. Seu contrato da MRL Travel foi assinado e aprovado com sucesso.\n\nAgora está tudo certo por aqui. Em breve nossa equipe segue com os próximos passos do seu atendimento.`;
  const dedupeKey = `contract-approved:${input.contractId}`;
  const url = Deno.env.get("CUSTOMER_WHATSAPP_WEBHOOK_URL")?.trim();
  const secret = Deno.env.get("CUSTOMER_WHATSAPP_WEBHOOK_SECRET")?.trim();

  if (input.customerPhone && url && secret) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-mrl-notification-token": secret },
        body: JSON.stringify({
          event: "contract.approved", dedupeKey, clientId: input.clientId, contractId: input.contractId,
          recipient: { name: input.customerName, phone: input.customerPhone }, message, signedPdfUrl: input.signedPdfUrl,
        }),
      });
      if (!response.ok) throw new Error(`WhatsApp respondeu HTTP ${response.status}`);
      await mark(admin, input.requestId, { status: "sent" });
      return { status: "sent" };
    } catch (error) {
      const reason = error instanceof Error ? error.message.slice(0, 500) : "Falha no envio por WhatsApp.";
      await mark(admin, input.requestId, { status: "failed", error: reason });
      return { status: "failed", error: reason };
    }
  }

  const recipient = input.customerPhone ?? input.customerEmail;
  const channel = input.customerPhone ? "whatsapp" : input.customerEmail ? "email" : "in_app";
  const pending = await admin.from("notifications").insert({
    client_id: input.clientId,
    channel,
    template_key: "contract_approved",
    recipient_masked: maskRecipient(recipient),
    status: "pending",
    payload: { dedupeKey, contractId: input.contractId, requestId: input.requestId, message, signedPdfUrl: input.signedPdfUrl },
  });
  if (pending.error && pending.error.code !== "23505") throw pending.error;
  await mark(admin, input.requestId, { status: "pending_manual", error: "Canal automático não configurado; pendência registrada." });
  return { status: "pending_manual" };
}

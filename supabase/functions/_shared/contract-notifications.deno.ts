import { sendCustomerContractApprovedMessage } from "./contract-notifications.ts";

function assertEquals(actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`Esperado ${JSON.stringify(expected)}, recebido ${JSON.stringify(actual)}`);
}

function fakeAdmin(options: { claim?: boolean } = {}) {
  const inserts: unknown[] = [];
  const updates: unknown[] = [];
  const builder = (result: { data?: unknown; error: unknown } = { error: null }) => {
    const value = {
      eq: () => value, is: () => value, or: () => value,
      select: () => value,
      maybeSingle: async () => ({ data: options.claim === false ? null : { id: "request" }, error: null }),
      then: (resolve: (result: unknown) => unknown) => Promise.resolve(result).then(resolve),
    };
    return value;
  };
  return {
    inserts, updates,
    client: {
      from: () => ({
        update: (values: unknown) => { updates.push(values); return builder(); },
        insert: (values: unknown) => { inserts.push(values); return builder(); },
      }),
    },
  };
}

const input = {
  requestId: "request", clientId: "client", contractId: "contract", customerName: "Cliente",
  customerPhone: "+5537999999999", customerEmail: "cliente@example.com", signedPdfUrl: null,
};

Deno.test("falha no WhatsApp vira status failed sem lançar erro", async () => {
  const originalFetch = globalThis.fetch;
  Deno.env.set("CUSTOMER_WHATSAPP_WEBHOOK_URL", "https://example.invalid/hook");
  Deno.env.set("CUSTOMER_WHATSAPP_WEBHOOK_SECRET", "secret");
  globalThis.fetch = () => Promise.resolve(new Response("fail", { status: 500 }));
  try {
    const admin = fakeAdmin();
    const result = await sendCustomerContractApprovedMessage(admin.client as never, input);
    assertEquals(result.status, "failed");
  } finally {
    globalThis.fetch = originalFetch;
    Deno.env.delete("CUSTOMER_WHATSAPP_WEBHOOK_URL");
    Deno.env.delete("CUSTOMER_WHATSAPP_WEBHOOK_SECRET");
  }
});

Deno.test("sem canal automático registra pendência manual", async () => {
  const admin = fakeAdmin();
  const result = await sendCustomerContractApprovedMessage(admin.client as never, input);
  assertEquals(result.status, "pending_manual");
  assertEquals(admin.inserts.length, 1);
});

Deno.test("notificação já reivindicada não duplica envio", async () => {
  const admin = fakeAdmin({ claim: false });
  const result = await sendCustomerContractApprovedMessage(admin.client as never, input);
  assertEquals(result.status, "pending_manual");
  assertEquals(admin.inserts.length, 0);
});

import { buildAutentiqueSigners, isMonthlySendBlocked, parseDefaultWitnesses, webhookTransition } from "./autentique-rules.ts";

function assertEquals(actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`Esperado ${JSON.stringify(expected)}, recebido ${JSON.stringify(actual)}`);
}

const witnesses = parseDefaultWitnesses(JSON.stringify([
  { name: "Michael", email: "michael@example.com" },
  { name: "Gabriel", email: "gabriel@example.com" },
  { name: "Camilla", email: "camilla@example.com" },
]));

Deno.test("compõe cliente e três testemunhas", () => assertEquals(buildAutentiqueSigners([{ name: "Cliente", email: "cliente@example.com" }], witnesses, []).length, 4));
Deno.test("força o cliente como SIGN", () => assertEquals(buildAutentiqueSigners([{ name: "Cliente" }], witnesses, [])[0].action, "SIGN"));
Deno.test("usa SIGN_AS_A_WITNESS nas testemunhas", () => assertEquals(buildAutentiqueSigners([{ name: "Cliente" }], witnesses, []).slice(1).map((item) => item.action), ["SIGN_AS_A_WITNESS", "SIGN_AS_A_WITNESS", "SIGN_AS_A_WITNESS"]));
Deno.test("testemunhas usam email", () => assertEquals(buildAutentiqueSigners([{ name: "Cliente" }], witnesses, [])[1].deliveryMethod, "email"));
Deno.test("permite remover testemunha no envio", () => assertEquals(buildAutentiqueSigners([{ name: "Cliente" }], witnesses, ["gabriel@example.com"]).length, 3));
Deno.test("sandbox não bloqueia por cota", () => assertEquals(isMonthlySendBlocked({ sandbox: true, used: 20, limit: 20, override: false, superAdmin: false }), false));
Deno.test("produção bloqueia no limite", () => assertEquals(isMonthlySendBlocked({ sandbox: false, used: 20, limit: 20, override: false, superAdmin: false }), true));
Deno.test("somente superadmin faz override", () => assertEquals([isMonthlySendBlocked({ sandbox: false, used: 20, limit: 20, override: true, superAdmin: false }), isMonthlySendBlocked({ sandbox: false, used: 20, limit: 20, override: true, superAdmin: true })], [true, false]));
Deno.test("document.finished aprova e notifica", () => assertEquals(webhookTransition("document.finished"), { contract: "completed", approve: true, notify: true }));
Deno.test("document.finished duplicado não notifica", () => assertEquals(webhookTransition("document.finished", true).notify, false));
Deno.test("rejeição não rebaixa aprovado", () => assertEquals(webhookTransition("signature.rejected", true).contract, undefined));
Deno.test("falha de entrega marca signatário", () => assertEquals(webhookTransition("signature.delivery_failed").signer, "failed"));

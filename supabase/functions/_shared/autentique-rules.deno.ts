import { buildAutentiqueSigners, isMonthlySendBlocked, parseContractorSigner, parseDefaultWitnesses, webhookTransition } from "./autentique-rules.ts";

function assertEquals(actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`Esperado ${JSON.stringify(expected)}, recebido ${JSON.stringify(actual)}`);
}

const witnesses = parseDefaultWitnesses(JSON.stringify([
  { name: "Gabriel", email: "gabriel@example.com" },
  { name: "Camilla", email: "camilla@example.com" },
]));
const contractor = parseContractorSigner(JSON.stringify({ name: "Michael", email: "mick_felipebh@hotmail.com" }));

Deno.test("compõe cliente, contratado e duas testemunhas", () => assertEquals(buildAutentiqueSigners([{ name: "Cliente", email: "cliente@example.com" }], contractor, witnesses, []).length, 4));
Deno.test("usa SIGN para cliente e contratado", () => assertEquals(buildAutentiqueSigners([{ name: "Cliente" }], contractor, witnesses, []).slice(0, 2).map((item) => item.action), ["SIGN", "SIGN"]));
Deno.test("usa SIGN_AS_A_WITNESS somente nas testemunhas", () => assertEquals(buildAutentiqueSigners([{ name: "Cliente" }], contractor, witnesses, []).slice(2).map((item) => item.action), ["SIGN_AS_A_WITNESS", "SIGN_AS_A_WITNESS"]));
Deno.test("salva os papéis no snapshot", () => assertEquals(buildAutentiqueSigners([{ name: "Cliente" }], contractor, witnesses, []).map((item) => item.signerRole), ["client_signer", "contractor_signer", "witness", "witness"]));
Deno.test("participantes configurados usam email", () => assertEquals(buildAutentiqueSigners([{ name: "Cliente" }], contractor, witnesses, []).slice(1).map((item) => item.deliveryMethod), ["email", "email", "email"]));
Deno.test("permite remover testemunha no envio", () => assertEquals(buildAutentiqueSigners([{ name: "Cliente" }], contractor, witnesses, ["gabriel@example.com"]).length, 3));
Deno.test("não duplica Michael e preserva seu papel quando já é signatário", () => assertEquals(buildAutentiqueSigners([{ name: "Michael", email: "mick_felipebh@hotmail.com" }], contractor, witnesses, []).filter((item) => item.name === "Michael").map((item) => item.signerRole), ["contractor_signer"]));
Deno.test("remove Michael da lista de testemunhas por segurança", () => assertEquals(buildAutentiqueSigners([{ name: "Cliente" }], contractor, [...witnesses, { name: "Michael", email: "mick_felipebh@hotmail.com" }], []).map((item) => item.signerRole), ["client_signer", "contractor_signer", "witness", "witness"]));
Deno.test("sandbox não bloqueia por cota", () => assertEquals(isMonthlySendBlocked({ sandbox: true, used: 20, limit: 20, override: false, superAdmin: false }), false));
Deno.test("produção bloqueia no limite", () => assertEquals(isMonthlySendBlocked({ sandbox: false, used: 20, limit: 20, override: false, superAdmin: false }), true));
Deno.test("somente superadmin faz override", () => assertEquals([isMonthlySendBlocked({ sandbox: false, used: 20, limit: 20, override: true, superAdmin: false }), isMonthlySendBlocked({ sandbox: false, used: 20, limit: 20, override: true, superAdmin: true })], [true, false]));
Deno.test("document.finished aprova e notifica", () => assertEquals(webhookTransition("document.finished"), { contract: "completed", approve: true, notify: true }));
Deno.test("document.finished duplicado não notifica", () => assertEquals(webhookTransition("document.finished", true).notify, false));
Deno.test("rejeição não rebaixa aprovado", () => assertEquals(webhookTransition("signature.rejected", true).contract, undefined));
Deno.test("falha de entrega marca signatário", () => assertEquals(webhookTransition("signature.delivery_failed").signer, "failed"));

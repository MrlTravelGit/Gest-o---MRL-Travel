import { describe, expect, it } from "vitest";
import { buildAutentiqueSigners, parseContractorSigner, parseDefaultWitnesses, webhookTransition } from "../../../supabase/functions/_shared/autentique-rules";

const contractor = parseContractorSigner('{"name":"Michael","email":"mick_felipebh@hotmail.com"}');
const witnesses = parseDefaultWitnesses('[{"name":"Gabriel","email":"gabriel@example.com"},{"name":"Camilla","email":"camilla@example.com"}]');

describe("participantes da Autentique", () => {
  it("envia cliente e Michael como SIGN e somente Gabriel e Camilla como testemunhas", () => {
    const signers = buildAutentiqueSigners([{ name: "Fábio Izaias", email: "fabio@example.com" }], contractor, witnesses, []);

    expect(signers.map(({ name, action, signerRole }) => ({ name, action, signerRole }))).toEqual([
      { name: "Fábio Izaias", action: "SIGN", signerRole: "client_signer" },
      { name: "Michael", action: "SIGN", signerRole: "contractor_signer" },
      { name: "Gabriel", action: "SIGN_AS_A_WITNESS", signerRole: "witness" },
      { name: "Camilla", action: "SIGN_AS_A_WITNESS", signerRole: "witness" },
    ]);
  });

  it("não adiciona Michael novamente quando ele já está entre os signatários", () => {
    const signers = buildAutentiqueSigners([
      { name: "Fábio Izaias", email: "fabio@example.com" },
      { name: "Michael", email: "mick_felipebh@hotmail.com" },
    ], contractor, witnesses, []);

    expect(signers.filter((signer) => signer.name === "Michael")).toEqual([
      expect.objectContaining({ action: "SIGN", signerRole: "contractor_signer" }),
    ]);
  });

  it("impede Michael de voltar como testemunha por configuração antiga", () => {
    const signers = buildAutentiqueSigners(
      [{ name: "Fábio Izaias", email: "fabio@example.com" }],
      contractor,
      [...witnesses, { name: "Michael", email: "mick_felipebh@hotmail.com" }],
      [],
    );

    expect(signers.filter((signer) => signer.name === "Michael")).toEqual([
      expect.objectContaining({ action: "SIGN", signerRole: "contractor_signer" }),
    ]);
  });
});

describe("transições do webhook da Autentique", () => {
  it("aprova e notifica somente em document.finished", () => {
    expect(webhookTransition("signature.accepted")).toEqual({ signer: "signed", approve: false, notify: false });
    expect(webhookTransition("document.finished")).toEqual({ contract: "completed", approve: true, notify: true });
  });

  it("não notifica novamente nem regride contrato já aprovado", () => {
    expect(webhookTransition("document.finished", true)).toEqual({ contract: "completed", approve: true, notify: false });
    expect(webhookTransition("signature.rejected", true)).toEqual({ signer: "rejected", contract: undefined, approve: false, notify: false });
  });

  it("mantém falha de entrega restrita ao participante", () => {
    expect(webhookTransition("signature.delivery_failed")).toEqual({ signer: "failed", approve: false, notify: false });
  });
});

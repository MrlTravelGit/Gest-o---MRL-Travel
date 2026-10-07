import { describe, expect, it } from "vitest";
import { buildAutentiqueSigners, parseContractorSigner, parseDefaultWitnesses } from "../../../supabase/functions/_shared/autentique-rules";

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

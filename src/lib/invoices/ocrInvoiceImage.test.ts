import { describe, expect, it } from "vitest";
import { validateInvoiceImage } from "./ocrInvoiceImage";

describe("validateInvoiceImage", () => {
  it("aceita PNG e JPEG", () => {
    expect(() => validateInvoiceImage(new File(["imagem"], "fatura.png", { type: "image/png" }))).not.toThrow();
    expect(() => validateInvoiceImage(new File(["imagem"], "fatura.jpg", { type: "image/jpeg" }))).not.toThrow();
  });

  it("explica que PDF será suportado em outro patch", () => {
    expect(() => validateInvoiceImage(new File(["pdf"], "fatura.pdf", { type: "application/pdf" }))).toThrow("Nesta versão, envie print em imagem. PDF entra no próximo patch.");
  });
});

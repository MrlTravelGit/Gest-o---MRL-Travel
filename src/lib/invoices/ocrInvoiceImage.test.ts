import { describe, expect, it } from "vitest";
import { isOcrSecurityPolicyError, OCR_SECURITY_MESSAGE, OCR_STARTUP_MESSAGE, TESSERACT_LOCAL_PATH, validateInvoiceImage } from "./ocrInvoiceImage";

describe("validateInvoiceImage", () => {
  it("aceita PNG e JPEG", () => {
    expect(() => validateInvoiceImage(new File(["imagem"], "fatura.png", { type: "image/png" }))).not.toThrow();
    expect(() => validateInvoiceImage(new File(["imagem"], "fatura.jpg", { type: "image/jpeg" }))).not.toThrow();
  });

  it("explica que PDF será suportado em outro patch", () => {
    expect(() => validateInvoiceImage(new File(["pdf"], "fatura.pdf", { type: "application/pdf" }))).toThrow("Nesta versão, envie print em imagem. PDF entra no próximo patch.");
  });

  it("identifica bloqueio de worker pela CSP", () => {
    const error = new DOMException("Creating a worker from blob: violates Content Security Policy directive: worker-src 'self'", "SecurityError");
    expect(isOcrSecurityPolicyError(error)).toBe(true);
    expect(OCR_SECURITY_MESSAGE).toContain("bloqueado pela segurança do navegador");
    expect(OCR_STARTUP_MESSAGE).toContain("iniciar o leitor local");
  });

  it("usa somente o diretório público local do Tesseract", () => {
    expect(TESSERACT_LOCAL_PATH).toBe("/vendor/tesseract");
  });
});

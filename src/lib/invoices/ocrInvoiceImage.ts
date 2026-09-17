export interface InvoiceOcrResult {
  rawText: string;
  warnings: string[];
}

const IMAGE_TYPES = new Set(["image/png", "image/jpeg"]);
const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg"]);

export function validateInvoiceImage(file: File): void {
  const extension = file.name.split(".").pop()?.toLowerCase() || "";
  if (file.type === "application/pdf" || extension === "pdf") {
    throw new Error("Nesta versão, envie print em imagem. PDF entra no próximo patch.");
  }
  if (!IMAGE_TYPES.has(file.type) && !IMAGE_EXTENSIONS.has(extension)) {
    throw new Error("Envie uma imagem PNG, JPG ou JPEG.");
  }
  if (file.size > 15 * 1024 * 1024) throw new Error("A imagem deve ter no máximo 15 MB.");
}

export async function ocrInvoiceImage(file: File): Promise<InvoiceOcrResult> {
  validateInvoiceImage(file);
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker(["por", "eng"]);
  try {
    const result = await worker.recognize(file, { rotateAuto: true });
    const rawText = result.data.text.trim();
    const warnings: string[] = [];
    if (rawText.length < 40) warnings.push("Pouco texto foi identificado. Confira todos os campos manualmente.");
    return { rawText, warnings };
  } finally {
    await worker.terminate();
  }
}

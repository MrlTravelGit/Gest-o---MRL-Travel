export interface InvoiceOcrResult {
  rawText: string;
  warnings: string[];
}

export const OCR_SECURITY_MESSAGE = "O leitor de print foi bloqueado pela segurança do navegador. O sistema precisa liberar worker local para OCR.";
export const OCR_STARTUP_MESSAGE = "Não foi possível iniciar o leitor local de print. Preencha manualmente ou ajuste a política de segurança.";
export const TESSERACT_LOCAL_PATH = "/vendor/tesseract";

export class InvoiceOcrStartupError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "InvoiceOcrStartupError";
  }
}

export function isOcrSecurityPolicyError(error: unknown): boolean {
  const message = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  return /(content security policy|worker-src|securityerror|refused to create a worker|violates.*policy|blocked.*worker)/i.test(message);
}

function isOcrWorkerStartupError(error: unknown): boolean {
  const message = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  return /(worker|importscripts|tesseract-core|webassembly|\.traineddata|failed to fetch|networkerror)/i.test(message);
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
  const { createWorker, OEM } = await import("tesseract.js");
  let worker;
  try {
    worker = await createWorker(["por", "eng"], OEM.LSTM_ONLY, {
      workerPath: `${TESSERACT_LOCAL_PATH}/worker.min.js`,
      corePath: TESSERACT_LOCAL_PATH,
      langPath: TESSERACT_LOCAL_PATH,
      workerBlobURL: false,
    });
  } catch (error) {
    throw new InvoiceOcrStartupError(isOcrSecurityPolicyError(error) ? OCR_SECURITY_MESSAGE : OCR_STARTUP_MESSAGE, { cause: error });
  }
  try {
    const result = await worker.recognize(file, { rotateAuto: true });
    const rawText = result.data.text.trim();
    const warnings: string[] = [];
    if (rawText.length < 40) warnings.push("Pouco texto foi identificado. Confira todos os campos manualmente.");
    return { rawText, warnings };
  } catch (error) {
    if (isOcrSecurityPolicyError(error) || isOcrWorkerStartupError(error)) {
      throw new InvoiceOcrStartupError(isOcrSecurityPolicyError(error) ? OCR_SECURITY_MESSAGE : OCR_STARTUP_MESSAGE, { cause: error });
    }
    throw error;
  } finally {
    await worker.terminate();
  }
}

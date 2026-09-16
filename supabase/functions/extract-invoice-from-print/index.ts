import { z } from "npm:zod@3.25.76";
import { adminErrorResponse, requireAdmin } from "../_shared/admin-auth.ts";
import { isAllowedOrigin, jsonResponse, preflightResponse } from "../_shared/http.ts";
import { adminClient } from "../_shared/supabase.ts";

const BUCKET = "invoice-uploads";
const MAX_FILE_SIZE = 15 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set(["image/png", "image/jpeg", "application/pdf"]);

const requestSchema = z.object({
  client_id: z.string().uuid(),
  file_path: z.string().min(20).max(800),
}).strict();

const extractionSchema = z.object({
  bank_name: z.string(),
  card_name: z.string(),
  card_last_digits: z.string(),
  competency_month: z.string(),
  due_date: z.string(),
  invoice_total: z.number().nullable(),
  exchange_rate: z.number().nullable(),
  exchange_rate_date: z.string(),
  loyalty_program_name: z.string(),
  actual_received_points: z.number().nullable(),
  confidence_score: z.number().min(0).max(100),
  warnings: z.array(z.string()),
}).strict();

const outputJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    bank_name: { type: "string" },
    card_name: { type: "string" },
    card_last_digits: { type: "string" },
    competency_month: { type: "string" },
    due_date: { type: "string" },
    invoice_total: { type: ["number", "null"] },
    exchange_rate: { type: ["number", "null"] },
    exchange_rate_date: { type: "string" },
    loyalty_program_name: { type: "string" },
    actual_received_points: { type: ["number", "null"] },
    confidence_score: { type: "number", minimum: 0, maximum: 100 },
    warnings: { type: "array", items: { type: "string" } },
  },
  required: ["bank_name", "card_name", "card_last_digits", "competency_month", "due_date", "invoice_total", "exchange_rate", "exchange_rate_date", "loyalty_program_name", "actual_received_points", "confidence_score", "warnings"],
} as const;

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

function extractOutputText(response: Record<string, unknown>): string | null {
  if (typeof response.output_text === "string") return response.output_text;
  if (!Array.isArray(response.output)) return null;
  for (const item of response.output) {
    if (!item || typeof item !== "object" || !Array.isArray((item as { content?: unknown }).content)) continue;
    for (const content of (item as { content: unknown[] }).content) {
      if (content && typeof content === "object" && typeof (content as { text?: unknown }).text === "string") return (content as { text: string }).text;
    }
  }
  return null;
}

function resolvePath(clientId: string, filePath: string) {
  const normalized = filePath.replace(/^\/+/, "");
  const parts = normalized.split("/");
  if (parts.length !== 4 || parts[0] !== BUCKET || parts[1] !== clientId || parts[3] !== "original") throw new Error("INVALID_FILE_PATH");
  const importId = z.string().uuid().parse(parts[2]);
  return { importId, objectPath: parts.slice(1).join("/"), canonicalPath: normalized };
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return preflightResponse(request);
  if (request.method !== "POST") return jsonResponse(request, { error: "Método não permitido." }, 405);
  if (!isAllowedOrigin(request)) return jsonResponse(request, { error: "Origem não autorizada." }, 403);

  let attemptId: string | null = null;
  try {
    const actor = await requireAdmin(request, ["super_admin", "manager", "operator"]);
    const parsedRequest = requestSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsedRequest.success) return jsonResponse(request, { code: "INVALID_REQUEST", error: "Arquivo ou cliente inválido." }, 422);

    const { client_id: clientId, file_path: filePath } = parsedRequest.data;
    const { importId, objectPath, canonicalPath } = resolvePath(clientId, filePath);
    attemptId = importId;
    const admin = adminClient();
    const client = await admin.from("clients").select("id").eq("id", clientId).maybeSingle();
    if (client.error || !client.data) return jsonResponse(request, { code: "CLIENT_NOT_FOUND", error: "Cliente não encontrado." }, 404);

    const attempt = await admin.from("invoice_import_attempts").upsert({
      id: importId,
      client_id: clientId,
      file_path: canonicalPath,
      status: "processing",
      extracted_data: {},
      warnings: [],
      error_message: null,
      created_by: actor.userId,
    }, { onConflict: "id" });
    if (attempt.error) throw attempt.error;

    const downloaded = await admin.storage.from(BUCKET).download(objectPath);
    if (downloaded.error || !downloaded.data) throw downloaded.error ?? new Error("FILE_DOWNLOAD_FAILED");
    const mimeType = downloaded.data.type || "";
    if (!ALLOWED_MIME_TYPES.has(mimeType) || downloaded.data.size > MAX_FILE_SIZE) throw new Error("INVALID_FILE_TYPE_OR_SIZE");

    const apiKey = Deno.env.get("OPENAI_API_KEY");
    if (!apiKey) throw new Error("OPENAI_API_KEY_MISSING");
    const bytes = new Uint8Array(await downloaded.data.arrayBuffer());
    const base64 = toBase64(bytes);
    const fileInput = mimeType === "application/pdf"
      ? { type: "input_file", filename: "fatura.pdf", file_data: `data:application/pdf;base64,${base64}`, detail: "high" }
      : { type: "input_image", image_url: `data:${mimeType};base64,${base64}`, detail: "high" };

    const aiResponse = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: Deno.env.get("OPENAI_INVOICE_MODEL") ?? "gpt-4.1-mini",
        input: [{
          role: "user",
          content: [
            fileInput,
            { type: "input_text", text: "Extraia somente os dados principais desta fatura de cartão. Não invente valores. Datas devem usar YYYY-MM-DD e competência YYYY-MM. Se um campo não estiver explícito, retorne string vazia ou null. Se a cotação for menor que 3 ou maior que 10, inclua um warning. Se o total não estiver claro, inclua um warning. O confidence_score deve ser de 0 a 100 e refletir a confiança global da leitura." },
          ],
        }],
        text: { format: { type: "json_schema", name: "invoice_extraction", strict: true, schema: outputJsonSchema } },
      }),
    });
    if (!aiResponse.ok) {
      console.error("extract-invoice-from-print OpenAI error", aiResponse.status, (await aiResponse.text()).slice(0, 500));
      throw new Error(`OPENAI_REQUEST_FAILED_${aiResponse.status}`);
    }

    const rawResponse = await aiResponse.json() as Record<string, unknown>;
    const outputText = extractOutputText(rawResponse);
    if (!outputText) throw new Error("OPENAI_EMPTY_OUTPUT");
    const extracted = extractionSchema.parse(JSON.parse(outputText));
    const warnings = [...extracted.warnings];
    if (extracted.exchange_rate != null && (extracted.exchange_rate < 3 || extracted.exchange_rate > 10) && !warnings.some((warning) => warning.toLowerCase().includes("cotação"))) {
      warnings.push("Confira a cotação. O valor extraído parece fora do padrão.");
    }
    if (extracted.invoice_total == null && !warnings.some((warning) => warning.toLowerCase().includes("total"))) warnings.push("O valor total da fatura não foi identificado com segurança.");
    const result = { ...extracted, warnings };

    const updated = await admin.from("invoice_import_attempts").update({
      status: "extracted",
      extracted_data: result,
      confidence_score: result.confidence_score,
      warnings,
      error_message: null,
    }).eq("id", importId);
    if (updated.error) throw updated.error;

    return jsonResponse(request, { attempt_id: importId, file_path: canonicalPath, extracted_data: result });
  } catch (error) {
    console.error("extract-invoice-from-print failed", error instanceof Error ? error.message : "unknown");
    if (attemptId) {
      try {
        await adminClient().from("invoice_import_attempts").update({ status: "failed", error_message: error instanceof Error ? error.message.slice(0, 500) : "unknown" }).eq("id", attemptId);
      } catch { /* best effort audit update */ }
    }
    if (error instanceof Response) return adminErrorResponse(error, request, {});
    return jsonResponse(request, { code: "INVOICE_EXTRACTION_FAILED", error: "Não foi possível ler o arquivo. Confira o formato e tente novamente." }, 500);
  }
});

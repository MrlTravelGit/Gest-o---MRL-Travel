import { adminErrorResponse, requireAdmin } from "../_shared/admin-auth.ts";
import { autentiqueMonthlyLimit, defaultAutentiqueContractorSigner, defaultAutentiqueWitnesses, productionMonthKey } from "../_shared/autentique-config.ts";
import { autentiqueSandbox } from "../_shared/autentique.ts";
import { isAllowedOrigin, jsonResponse, preflightResponse } from "../_shared/http.ts";
import { adminClient } from "../_shared/supabase.ts";

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return preflightResponse(request);
  if (request.method !== "POST") return jsonResponse(request, { error: "Método não permitido." }, 405);
  if (!isAllowedOrigin(request)) return jsonResponse(request, { error: "Origem não autorizada." }, 403);
  try {
    const actor = await requireAdmin(request, ["super_admin", "manager"]);
    const admin = adminClient();
    const monthKey = productionMonthKey();
    const usage = await admin.from("contract_signature_requests")
      .select("id", { count: "exact", head: true })
      .eq("sandbox", false)
      .eq("production_month_key", monthKey)
      .not("provider_document_id", "is", null)
      .neq("status", "failed");
    if (usage.error) throw usage.error;
    const witnesses = defaultAutentiqueWitnesses();
    const contractorSigner = defaultAutentiqueContractorSigner();
    const monthlyLimit = autentiqueMonthlyLimit();
    const canOverrideMonthlyLimit = actor.role === "super_admin";
    const contractorSignerWarning = contractorSigner ? null : "O signatário da contratada ainda não foi configurado.";
    return jsonResponse(request, {
      sandbox: autentiqueSandbox(),
      contractorSigner: contractorSigner ? { ...contractorSigner, role: "SIGN" } : null,
      contractorSignerConfigured: Boolean(contractorSigner),
      contractorSignerWarning,
      defaultWitnesses: witnesses.map((witness) => ({ ...witness, role: "SIGN_AS_A_WITNESS" })),
      monthlyQuota: { productionMonthKey: monthKey, productionUsed: usage.count ?? 0, monthlyLimit, canOverrideMonthlyLimit },
      witnesses, witnessesConfigured: witnesses.length > 0,
      productionMonthKey: monthKey, productionUsed: usage.count ?? 0,
      monthlyLimit, canOverrideMonthlyLimit,
    });
  } catch (error) {
    if (error instanceof Response) return adminErrorResponse(error, request, {});
    console.error("get-autentique-send-context failed", error instanceof Error ? error.message : "unknown");
    return jsonResponse(request, { error: "Não foi possível carregar a configuração da Autentique." }, 500);
  }
});

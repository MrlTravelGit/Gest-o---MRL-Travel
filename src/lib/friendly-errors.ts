export interface FriendlyErrorContext {
  action?: string;
  programName?: string | null;
  availablePoints?: number | string | null;
  requestedPoints?: number | string | null;
  clientName?: string | null;
}

const pointsFormatter = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });

export function toFriendlyNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value !== "string") return 0;
  const normalized = value.trim().replace(/\./g, "").replace(",", ".").replace(/[^\d.-]/g, "");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function formatFriendlyPoints(value: unknown): string {
  return pointsFormatter.format(Math.max(0, Math.floor(toFriendlyNumber(value))));
}

export function buildInsufficientPointsMessage(context: FriendlyErrorContext = {}): string {
  const programName = context.programName?.trim() || "programa selecionado";
  const available = Math.max(0, toFriendlyNumber(context.availablePoints));
  const requested = Math.max(0, toFriendlyNumber(context.requestedPoints));
  if (requested > 0) {
    return `Saldo insuficiente em ${programName}. O cliente tem ${formatFriendlyPoints(available)} pontos disponíveis, mas você tentou usar ${formatFriendlyPoints(requested)} pontos. Ajuste os pontos utilizados para até ${formatFriendlyPoints(available)} ou atualize o saldo do programa antes de registrar a viagem.`;
  }
  return `Saldo insuficiente em ${programName}. Atualize o saldo do programa ou reduza a quantidade de pontos utilizados antes de tentar novamente.`;
}

function technicalErrorText(error: unknown): string {
  if (typeof error === "string") return error;
  if (!error || typeof error !== "object") return "";
  const source = error as Record<string, unknown>;
  return [source.code, source.status, source.message, source.details, source.hint]
    .filter((value) => value != null)
    .map(String)
    .join(" ");
}

function insufficientPointsDetails(error: unknown): Partial<FriendlyErrorContext> {
  if (!error || typeof error !== "object") return {};
  const details = (error as Record<string, unknown>).details;
  if (typeof details !== "string") return {};
  try {
    const start = details.indexOf("{");
    const parsed = JSON.parse(start >= 0 ? details.slice(start) : details) as Record<string, unknown>;
    return {
      programName: typeof parsed.program_name === "string" ? parsed.program_name : undefined,
      availablePoints: typeof parsed.available_points === "number" || typeof parsed.available_points === "string" ? parsed.available_points : undefined,
      requestedPoints: typeof parsed.requested_points === "number" || typeof parsed.requested_points === "string" ? parsed.requested_points : undefined,
    };
  } catch {
    return {};
  }
}

export function getFriendlyErrorMessage(error: unknown, context: FriendlyErrorContext = {}): string {
  const combined = technicalErrorText(error).toLowerCase();
  if (["insufficient_points", "insufficient points", "saldo insuficiente", "not enough points"].some((token) => combined.includes(token))) {
    return buildInsufficientPointsMessage({ ...context, ...insufficientPointsDetails(error) });
  }
  if (["duplicate key value", "violates unique constraint", "idempotency_conflict", "23505"].some((token) => combined.includes(token))) {
    return "Este registro já existe no sistema. Confira os dados informados ou atualize o cadastro existente.";
  }
  if (["jwt", "unauthorized", "not authenticated", "401"].some((token) => combined.includes(token))) {
    return "Sua sessão expirou ou você não tem permissão para concluir essa operação. Entre novamente e tente de novo.";
  }
  if (["network", "failed to fetch", "fetch failed", "networkerror"].some((token) => combined.includes(token))) {
    return "Não foi possível conectar ao servidor. Verifique a internet e tente novamente.";
  }
  if (context.action) {
    return `Não foi possível concluir a operação: ${context.action}. Tente novamente ou revise os dados informados.`;
  }
  return "Não foi possível concluir a operação. Revise os dados informados e tente novamente.";
}

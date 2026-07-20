import { supabase } from "@/lib/supabase";
import type { ManagementTaskInput, ManagementTasksResult, TaskFilters } from "@/types/management-tasks";

const TASK_ERRORS: Record<string, string> = {
  FORBIDDEN: "Seu perfil não possui permissão para alterar demandas.",
  TASK_NOT_FOUND: "A demanda não foi encontrada ou já foi arquivada.",
  INVALID_STATUS: "O status selecionado é inválido.",
  INVALID_SCOPE: "Selecione um escopo válido.",
  INVALID_CATEGORY: "Selecione uma categoria válida.",
  INVALID_PRIORITY: "Selecione uma prioridade válida.",
  ARCHIVE_REASON_REQUIRED: "Informe um motivo com pelo menos cinco caracteres.",
};

function taskError(error: unknown): Error {
  const raw = error instanceof Error ? error.message : typeof error === "object" && error && "message" in error ? String(error.message) : "";
  const match = Object.entries(TASK_ERRORS).find(([code]) => raw.includes(code));
  return new Error(match?.[1] ?? "A operação com a demanda não foi concluída.");
}

export async function getManagementTasks(filters: TaskFilters = {}): Promise<ManagementTasksResult> {
  const { data, error } = await supabase.rpc("get_admin_management_tasks", {
    p_client_id: filters.clientId || null, p_search: filters.search || null, p_status: filters.status || null,
    p_priority: filters.priority || null, p_category: filters.category || null, p_assigned_staff_id: filters.assignedStaffId || null,
    p_source: filters.source || null, p_due_from: filters.dueFrom || null, p_due_to: filters.dueTo || null,
    p_sort: filters.sort ?? "due_at", p_direction: filters.direction ?? "asc", p_limit: filters.limit ?? 20, p_offset: filters.offset ?? 0,
  });
  if (error || !data) throw taskError(error);
  return data as unknown as ManagementTasksResult;
}

export async function createManagementTask(input: ManagementTaskInput) {
  const { data, error } = await supabase.rpc("admin_create_management_task", { p_payload: input });
  if (error || !data) throw taskError(error);
  return data;
}

export async function updateManagementTask(taskId: string, input: Partial<ManagementTaskInput>) {
  const { data, error } = await supabase.rpc("admin_update_management_task", { p_task_id: taskId, p_payload: input });
  if (error || !data) throw taskError(error);
  return data;
}

export async function archiveManagementTask(taskId: string, reason: string) {
  const { data, error } = await supabase.rpc("admin_archive_management_task", { p_task_id: taskId, p_reason: reason });
  if (error || !data) throw taskError(error);
  return data;
}

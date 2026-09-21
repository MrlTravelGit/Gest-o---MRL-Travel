import { supabase } from "@/lib/supabase";
import { isOperationalClientName } from "@/lib/operational-client";
import type { AdminFormOptions } from "@/types/admin-modules";

export async function getAdminFormOptions(): Promise<AdminFormOptions> {
  const { data, error } = await supabase.rpc("get_admin_form_options");
  if (error || !data) throw new Error("Não foi possível carregar clientes e programas.");
  const result = data as unknown as AdminFormOptions;
  return { ...result, clients: result.clients.filter((client) => isOperationalClientName(client.fullName)) };
}

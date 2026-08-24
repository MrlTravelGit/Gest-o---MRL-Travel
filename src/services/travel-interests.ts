import { supabase } from "@/lib/supabase";
import type { TravelInterestsResult, TravelInterestPriority, TravelInterestStatus } from "@/types/admin-modules";

export type SaveTravelInterestInput = {
  clientId: string; destination: string; startDate?: string; endDate?: string; details: string;
  status: TravelInterestStatus; priority: TravelInterestPriority; publicVisible: boolean;
  publicNote?: string; internalNote?: string; nextActionOn?: string; assignedTo?: string;
  statusNote?: string; interestId?: string;
};

export async function getClientTravelInterests(clientId: string, status = "", limit = 50, offset = 0): Promise<TravelInterestsResult> {
  const { data, error } = await supabase.rpc("get_client_travel_interests_admin", { p_client_id: clientId, p_status: status || null, p_limit: limit, p_offset: offset });
  if (error || !data) throw new Error("Não foi possível carregar os interesses deste cliente.");
  return data as unknown as TravelInterestsResult;
}

export async function getTravelInterestAssignees(): Promise<Array<{ id: string; name: string }>> {
  const { data, error } = await supabase.rpc("get_travel_interest_assignees_admin");
  if (error || !data) throw new Error("Não foi possível carregar os responsáveis.");
  return data as unknown as Array<{ id: string; name: string }>;
}

export async function getTravelInterests(search = "", status = "", limit = 20, offset = 0): Promise<TravelInterestsResult> {
  const { data, error } = await supabase.rpc("get_travel_interests", { p_search: search || null, p_status: status || null, p_limit: limit, p_offset: offset });
  if (error || !data) throw new Error("Não foi possível carregar os interesses.");
  return data as unknown as TravelInterestsResult;
}

export async function saveTravelInterest(input: SaveTravelInterestInput) {
  const { data, error } = await supabase.rpc("upsert_travel_interest_v2", { p_client_id: input.clientId, p_destination: input.destination, p_start_date: input.startDate || null, p_end_date: input.endDate || null, p_details: input.details, p_status: input.status, p_priority: input.priority, p_public_visible: input.publicVisible, p_public_note: input.publicNote || null, p_internal_note: input.internalNote || null, p_next_action_on: input.nextActionOn || null, p_assigned_to: input.assignedTo || null, p_status_note: input.statusNote || null, p_interest_id: input.interestId || null });
  if (error || !data) throw new Error("O interesse não foi salvo. Verifique o período e os campos obrigatórios.");
  return data;
}

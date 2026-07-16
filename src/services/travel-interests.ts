import { supabase } from "@/lib/supabase";
import type { TravelInterestsResult, TravelInterestStatus } from "@/types/admin-modules";

export async function getTravelInterests(search = "", status = "", limit = 20, offset = 0): Promise<TravelInterestsResult> {
  const { data, error } = await supabase.rpc("get_travel_interests", { p_search: search || null, p_status: status || null, p_limit: limit, p_offset: offset });
  if (error || !data) throw new Error("Não foi possível carregar os interesses.");
  return data as unknown as TravelInterestsResult;
}

export async function saveTravelInterest(input: { clientId: string; destination: string; startDate?: string; endDate?: string; details: string; status: TravelInterestStatus; interestId?: string }) {
  const { data, error } = await supabase.rpc("upsert_travel_interest", { p_client_id: input.clientId, p_destination: input.destination, p_start_date: input.startDate || null, p_end_date: input.endDate || null, p_details: input.details, p_status: input.status, p_interest_id: input.interestId || null });
  if (error || !data) throw new Error("O interesse não foi salvo. Verifique o período e os campos obrigatórios.");
  return data;
}

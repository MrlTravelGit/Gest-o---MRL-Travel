import { supabase } from "@/lib/supabase";
import type { RankingResult } from "@/types/admin-modules";

export async function getPointsRanking(search = "", limit = 20, offset = 0): Promise<RankingResult> {
  const { data, error } = await supabase.rpc("get_points_ranking", { p_search: search || null, p_limit: limit, p_offset: offset });
  if (error || !data) throw new Error("Não foi possível carregar o ranking.");
  return data as unknown as RankingResult;
}

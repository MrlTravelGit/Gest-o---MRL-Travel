import { supabase } from "@/lib/supabase";

export interface CreateClientInput {
  fullName: string;
  email?: string;
  phone?: string;
  accessChannel: "email" | "phone";
  startsOn: string;
  endsOn: string;
  planName?: string;
}

export interface CreateClientResult {
  clientId: string;
  publicId: string;
  accessLink: string;
}

export async function createClient(input: CreateClientInput): Promise<CreateClientResult> {
  const { data, error } = await supabase.functions.invoke<CreateClientResult>(
    "admin-create-client",
    { body: input },
  );

  if (error || !data) throw new Error("Não foi possível cadastrar o cliente");
  return data;
}

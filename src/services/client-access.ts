import { supabase } from "@/lib/supabase";

interface RequestAccessInput {
  publicId: string;
  firstName: string;
}

interface RequestAccessResult {
  accepted: true;
  message: string;
  destination: string;
  challengeId: string;
}

export async function requestClientAccess(input: RequestAccessInput): Promise<RequestAccessResult> {
  const { data, error } = await supabase.functions.invoke<RequestAccessResult>(
    "request-client-access",
    { body: input },
  );

  if (error || !data) throw new Error("Não foi possível solicitar o código");
  return data;
}

export async function verifyClientAccess(input: RequestAccessInput & {
  challengeId: string;
  code: string;
}): Promise<void> {
  const { data, error } = await supabase.functions.invoke<{
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
  }>("verify-client-access", { body: input });

  if (error || !data?.accessToken || !data.refreshToken) {
    throw new Error("Código inválido ou expirado");
  }

  const { error: sessionError } = await supabase.auth.setSession({
    access_token: data.accessToken,
    refresh_token: data.refreshToken,
  });

  if (sessionError) throw new Error("Não foi possível iniciar a sessão");
}

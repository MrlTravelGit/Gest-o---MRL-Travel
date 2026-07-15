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

interface FunctionErrorPayload {
  error?: unknown;
}

export async function createClientErrorMessage(error: unknown): Promise<string> {
  if (error && typeof error === "object" && "context" in error) {
    const response = (error as { context?: unknown }).context;
    if (response instanceof Response) {
      const payload = await response.clone().json().catch(() => null) as FunctionErrorPayload | null;
      if (typeof payload?.error === "string" && payload.error.trim()) {
        return payload.error;
      }
    }
  }

  if (error instanceof Error && /failed to send|fetch|network/i.test(error.message)) {
    return "Não foi possível acessar o backend. Abra o endereço oficial da Vercel e atualize a página.";
  }

  return "Não foi possível cadastrar o cliente. Consulte a resposta da requisição no backend.";
}

export async function createClient(input: CreateClientInput): Promise<CreateClientResult> {
  const { data, error } = await supabase.functions.invoke<CreateClientResult>(
    "admin-create-client",
    { body: input },
  );

  if (error) throw new Error(await createClientErrorMessage(error));
  if (!data) throw new Error("O backend não retornou o cadastro criado.");
  return data;
}

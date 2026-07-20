export function validateClientPanelUrl(url?: string | null): string {
  if (!url) throw new Error("Link indisponível.");
  const parsed = new URL(url);
  const allowedHost = new URL("https://gestao-mrltravel.vercel.app").hostname;
  if (parsed.protocol !== "https:") throw new Error("Link inválido.");
  if (parsed.hostname !== allowedHost) throw new Error("Origem não autorizada.");
  if (!/^\/economia\/[a-f0-9]{64}$/i.test(parsed.pathname)) throw new Error("Rota do painel inválida.");
  return parsed.toString();
}

export function openClientPanel(url?: string | null): { opened: boolean; url?: string; message: string } {
  try {
    const validatedUrl = validateClientPanelUrl(url);
    const opened = window.open(validatedUrl, "_blank", "noopener,noreferrer");
    return opened
      ? { opened: true, url: validatedUrl, message: "Painel aberto em nova aba." }
      : { opened: false, url: validatedUrl, message: "Pop-up bloqueado. Copie o link manualmente." };
  } catch {
    return { opened: false, message: "O link do painel está indisponível ou inválido." };
  }
}

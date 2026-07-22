export function clientStatusLabel(status: string): string {
  if (status === "ended") return "Arquivado";
  if (status === "lead") return "Aguardando ativação";
  if (status === "active") return "Ativo";
  if (status === "paused") return "Pausado";
  return status;
}

export function leadActivationCopy(clientName: string) {
  return {
    title: "Aguardando ativação",
    support: `Cadastro recebido pelo formulário de onboarding. Revise os dados de ${clientName} e ative o cliente.`,
  };
}

export function contractDatesAreValid(startsOn: string, endsOn: string): boolean {
  return Boolean(startsOn) && (!endsOn || endsOn >= startsOn);
}

export function requiresContractChangeReason(previous: { startsOn: string; endsOn: string | null } | null, next: { startsOn: string; endsOn: string | null }): boolean {
  return Boolean(previous && (previous.startsOn !== next.startsOn || previous.endsOn !== next.endsOn));
}

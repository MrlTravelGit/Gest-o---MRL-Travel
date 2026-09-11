export interface ClientProgramWalletRelation {
  balance?: number | null;
  clubActive?: boolean | null;
  clubExpiresAt?: string | null;
  linkedAccount?: boolean | null;
  accountStatus?: string | null;
}

export function shouldShowClientProgram(
  program: ClientProgramWalletRelation,
  today = localIsoDate(),
) {
  return Number(program.balance ?? 0) > 0
    || program.clubActive === true
    || Boolean(program.clubExpiresAt && program.clubExpiresAt.slice(0, 10) >= today)
    || program.linkedAccount === true
    || program.accountStatus === "linked";
}

function localIsoDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

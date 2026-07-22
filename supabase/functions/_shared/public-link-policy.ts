export const CONTRACT_REVIEW_NOTICE = "Contrato pendente de revisão";

export interface PublicLinkAccessPolicy {
  allowed: boolean;
  code: "CLIENT_NOT_ACTIVE" | null;
  notice: string | null;
}

export function evaluatePublicLinkAccess(
  clientStatus: string | null | undefined,
  contractReviewStatus?: string | null,
  hasActiveContract?: boolean | null,
): PublicLinkAccessPolicy {
  if (clientStatus !== "active") {
    return { allowed: false, code: "CLIENT_NOT_ACTIVE", notice: null };
  }

  return {
    allowed: true,
    code: null,
    notice: contractReviewStatus === "pending_review" || hasActiveContract === false
      ? CONTRACT_REVIEW_NOTICE
      : null,
  };
}

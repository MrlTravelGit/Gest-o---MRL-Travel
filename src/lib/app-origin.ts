export interface AppOriginStatus {
  canonicalOrigin: string | null;
  isCanonical: boolean;
}

export function getAppOriginStatus(
  currentOrigin: string,
  configuredAppUrl: string | undefined,
): AppOriginStatus {
  if (!configuredAppUrl) {
    return { canonicalOrigin: null, isCanonical: false };
  }

  try {
    const canonicalOrigin = new URL(configuredAppUrl).origin;
    return {
      canonicalOrigin,
      isCanonical: currentOrigin === canonicalOrigin,
    };
  } catch {
    return { canonicalOrigin: null, isCanonical: false };
  }
}

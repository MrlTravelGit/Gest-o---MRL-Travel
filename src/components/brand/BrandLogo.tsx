import { useState } from "react";

export const OFFICIAL_BRAND_ASSET = "/assets/brand/logo-mrl-travel.svg";

export function BrandLogo({ size = "medium", className = "" }: { size?: "small" | "medium" | "large"; className?: string }) {
  const [available, setAvailable] = useState(true);
  return <span className={`official-brand-logo brand-${size} ${className}`.trim()}>
    {available ? <img src={OFFICIAL_BRAND_ASSET} alt="MRL Travel" width={size === "small" ? 82 : size === "large" ? 160 : 112} height={size === "small" ? 64 : size === "large" ? 125 : 88} onError={() => setAvailable(false)} /> : <span role="img" aria-label="MRL Travel">MRL Travel</span>}
  </span>;
}

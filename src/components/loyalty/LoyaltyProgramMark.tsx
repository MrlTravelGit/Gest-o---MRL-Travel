import { useEffect, useState } from "react";
import { resolveLoyaltyProgramBrand } from "@/lib/loyalty-program-brand";

export type LoyaltyProgramMarkProps = {
  name: string;
  slug?: string | null;
  logoUrl?: string | null;
  size?: "sm" | "md" | "lg";
  showName?: boolean;
  className?: string;
};

export function LoyaltyProgramMark({ name, slug, logoUrl, size = "md", showName = false, className = "" }: LoyaltyProgramMarkProps) {
  const brand = resolveLoyaltyProgramBrand({ name, slug, logoUrl });
  const [imageAvailable, setImageAvailable] = useState(Boolean(brand.assetPath));

  useEffect(() => setImageAvailable(Boolean(brand.assetPath)), [brand.assetPath]);

  return <span className={`loyalty-program-mark loyalty-program-mark-${size} ${className}`.trim()}>
    {brand.assetPath && imageAvailable
      ? <img src={brand.assetPath} alt={`Logo ${brand.displayName}`} loading="lazy" onError={() => setImageAvailable(false)} />
      : <span className="loyalty-program-monogram" aria-label={`Logo indisponível para ${name}`}><strong>{brand.monogram}</strong></span>}
    {showName && <span className="loyalty-program-name">{name}</span>}
  </span>;
}

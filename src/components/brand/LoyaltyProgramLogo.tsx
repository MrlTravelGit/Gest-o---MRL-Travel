import { useState } from "react";
import { resolveLoyaltyProgramBrand } from "@/lib/loyalty-program-brand";

export function LoyaltyProgramLogo({ program }: { program: { slug?: string | null; name: string; logoUrl?: string | null } }) {
  const brand = resolveLoyaltyProgramBrand(program);
  const [imageAvailable, setImageAvailable] = useState(Boolean(brand.assetPath));
  function handleMissingAsset() {
    setImageAvailable(false);
    if (import.meta.env.DEV) console.warn(`Logo local não encontrado para programa: ${brand.key}`);
  }
  if (brand.assetPath && imageAvailable) return <img src={brand.assetPath} alt={`Logo ${brand.displayName}`} loading="lazy" onError={handleMissingAsset} />;
  return <div className="program-logo-fallback" aria-label={`Logo indisponível para ${program.name}`}><strong>{brand.monogram}</strong><span>{brand.known ? brand.displayName : program.name}</span></div>;
}

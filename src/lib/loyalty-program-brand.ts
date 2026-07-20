export interface LoyaltyProgramBrand {
  key: string;
  displayName: string;
  assetPath: string;
  aliases: string[];
}

export interface ResolvedLoyaltyProgramBrand {
  key: string;
  displayName: string;
  assetPath: string | null;
  monogram: string;
  known: boolean;
}

export const LOYALTY_PROGRAM_BRANDS = [
  {
    key: "atomos",
    displayName: "Átomos",
    assetPath: "/assets/loyalty-programs/%C3%A1tomos.svg",
    aliases: ["atomos", "átomos", "c6 atomos", "c6 átomos", "c6-bank-atomos"],
  },
  {
    key: "azul-fidelidade",
    displayName: "Azul Fidelidade",
    assetPath: "/assets/loyalty-programs/azul.svg",
    aliases: ["azul", "azul fidelidade", "azul-fidelidade", "tudo azul", "tudoazul"],
  },
  {
    key: "esfera",
    displayName: "Esfera",
    assetPath: "/assets/loyalty-programs/esfera.svg",
    aliases: ["esfera", "santander esfera", "programa esfera"],
  },
  {
    key: "smiles",
    displayName: "Smiles",
    assetPath: "/assets/loyalty-programs/smiles.svg",
    aliases: ["smiles", "gol smiles"],
  },
  {
    key: "latam-pass",
    displayName: "LATAM Pass",
    assetPath: "/assets/loyalty-programs/latam-pass.svg",
    aliases: ["latam", "latam pass", "latam-pass", "latampass"],
  },
  {
    key: "livelo",
    displayName: "Livelo",
    assetPath: "/assets/loyalty-programs/logo-livelo.svg",
    aliases: ["livelo"],
  },
] as const satisfies readonly LoyaltyProgramBrand[];

const aliasIndex = new Map<string, LoyaltyProgramBrand>();

for (const brand of LOYALTY_PROGRAM_BRANDS) {
  aliasIndex.set(normalizeProgramIdentifier(brand.key), brand);
  aliasIndex.set(normalizeProgramIdentifier(brand.displayName), brand);
  for (const alias of brand.aliases) {
    aliasIndex.set(normalizeProgramIdentifier(alias), brand);
  }
}

export function resolveLoyaltyProgramBrand(program: { slug?: string | null; name: string; logoUrl?: string | null }): ResolvedLoyaltyProgramBrand {
  const candidates = [program.slug, program.name].filter(Boolean).map((value) => normalizeProgramIdentifier(value ?? ""));
  const brand = candidates.map((candidate) => aliasIndex.get(candidate)).find(Boolean);

  if (brand) {
    return {
      key: brand.key,
      displayName: brand.displayName,
      assetPath: brand.assetPath,
      monogram: createProgramMonogram(program.name || brand.displayName),
      known: true,
    };
  }

  return {
    key: normalizeProgramIdentifier(program.slug || program.name) || "programa",
    displayName: program.name,
    assetPath: isLocalAssetPath(program.logoUrl) ? program.logoUrl : null,
    monogram: createProgramMonogram(program.name),
    known: false,
  };
}

export function normalizeProgramIdentifier(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " e ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, "-");
}

function createProgramMonogram(name: string): string {
  const normalized = name.trim();
  if (!normalized) return "MR";

  const words = normalized
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);

  if (words.length >= 2) return words.map((word) => word[0]).join("").toUpperCase();
  return normalized.slice(0, 2).toUpperCase();
}

function isLocalAssetPath(value?: string | null): value is string {
  return Boolean(value && value.startsWith("/") && !value.startsWith("//"));
}

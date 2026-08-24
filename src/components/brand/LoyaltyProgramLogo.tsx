import { LoyaltyProgramMark } from "@/components/loyalty/LoyaltyProgramMark";

export function LoyaltyProgramLogo({ program }: { program: { slug?: string | null; name: string; logoUrl?: string | null } }) {
  return <LoyaltyProgramMark name={program.name} slug={program.slug} logoUrl={program.logoUrl} size="lg" showName={false} className="public-program-mark" />;
}

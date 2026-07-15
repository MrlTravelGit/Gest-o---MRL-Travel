import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminProgramDetail } from "@/types/admin-clients";

const { setProgramClubStatus } = vi.hoisted(() => ({ setProgramClubStatus: vi.fn() }));
vi.mock("@/services/admin-clients", () => ({ setProgramClubStatus }));

import { ProgramAccountCard } from "./ProgramAccountCard";

const program: AdminProgramDetail = {
  programId: "program-1", slug: "smiles", name: "Smiles", logoUrl: null,
  accountId: null, balance: 0, averageCostPerThousand: 0, estimatedValue: 0,
  marketValuePerThousand: 18, clubActive: false, clubUpdatedAt: null,
  expiringPoints: 0, nextExpirationDate: null, lastUpdatedAt: null,
};

describe("ProgramAccountCard", () => {
  beforeEach(() => setProgramClubStatus.mockReset());

  it("salva o clube ativo por programa", async () => {
    setProgramClubStatus.mockResolvedValue({ clubActive: true });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><ProgramAccountCard clientId="client-1" program={program} canWrite /></QueryClientProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Sim" }));
    await waitFor(() => expect(setProgramClubStatus).toHaveBeenCalledWith("client-1", "program-1", true));
    expect(await screen.findByText("Clube atualizado.")).toBeInTheDocument();
  });
});

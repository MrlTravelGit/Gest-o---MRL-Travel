import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Outlet } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/routes/AdminProtectedRoute", () => ({ AdminProtectedRoute: () => <Outlet /> }));
vi.mock("@/pages/admin/AdminClientEconomyPreviewPage", () => ({ AdminClientEconomyPreviewPage: () => <h1>Prévia administrativa correta</h1> }));

describe("rota da prévia administrativa", () => {
  it("abre /admin/clientes/:clientId/preview sem cair no fallback", async () => {
    const { default: App } = await import("./App");
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={queryClient}><MemoryRouter initialEntries={["/admin/clientes/123/preview"]}><App /></MemoryRouter></QueryClientProvider>);
    expect(await screen.findByRole("heading", { name: "Prévia administrativa correta" })).toBeInTheDocument();
    expect(screen.queryByText("Página não encontrada")).not.toBeInTheDocument();
  });
});

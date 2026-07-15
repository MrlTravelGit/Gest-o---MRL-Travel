import type { ReactNode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { createClient } = vi.hoisted(() => ({ createClient: vi.fn() }));

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: undefined, isError: false }),
}));
vi.mock("@/components/layout/AppShell", () => ({
  AppShell: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@/services/admin", () => ({ createClient }));
vi.mock("@/services/dashboard", () => ({ getAdminOverview: vi.fn() }));
vi.mock("@/lib/env", () => ({
  env: { VITE_APP_URL: "https://gestao-mrltravel.vercel.app" },
}));

import { AdminDashboardPage } from "./AdminDashboardPage";

describe("AdminDashboardPage em Preview", () => {
  beforeEach(() => createClient.mockReset());

  it("não envia o cadastro e oferece o link de Production", () => {
    render(<MemoryRouter><AdminDashboardPage /></MemoryRouter>);

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Este endereço é um Preview da Vercel",
    );
    expect(screen.getByRole("link", { name: "Abrir o ambiente oficial" }))
      .toHaveAttribute("href", "https://gestao-mrltravel.vercel.app");

    const button = screen.getByRole("button", { name: "Criar cliente e acesso" });
    expect(button).toBeDisabled();
    fireEvent.submit(button.closest("form")!);

    expect(createClient).not.toHaveBeenCalled();
  });
});

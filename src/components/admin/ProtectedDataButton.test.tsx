import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ProtectedDataButton } from "./ProtectedDataButton";

vi.mock("@/services/management-terms", () => ({
  buildVaultClientUrl: (clientId: string) => "http://192.168.0.25:7443/clients/" + encodeURIComponent(clientId),
}));

const clientId = "123e4567-e89b-42d3-a456-426614174000";

describe("botao de dados protegidos", () => {
  it("nao aparece sem vault_access", () => {
    render(<ProtectedDataButton clientId={clientId} allowed={false} />);
    expect(screen.queryByRole("button", { name: "Abrir dados protegidos" })).not.toBeInTheDocument();
  });

  it("abre somente o client_id em nova aba quando autorizado", () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    render(<ProtectedDataButton clientId={clientId} allowed />);
    fireEvent.click(screen.getByRole("button", { name: "Abrir dados protegidos" }));
    expect(open).toHaveBeenCalledWith(
      "http://192.168.0.25:7443/clients/" + clientId,
      "_blank",
      "noopener,noreferrer,width=1100,height=720",
    );
    expect(String(open.mock.calls[0][0])).not.toMatch(/token|cpf|email|password/i);
    open.mockRestore();
  });

  it("mantem ajuda operacional no modo compacto", () => {
    render(<ProtectedDataButton clientId={clientId} allowed compact state="pending" />);
    expect(screen.getByRole("button", { name: "Cadastro aguardando sincronização com a Gestão" })).toBeInTheDocument();
  });
});

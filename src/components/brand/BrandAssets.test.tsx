import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BrandLogo, OFFICIAL_BRAND_ASSET } from "./BrandLogo";
import { LoyaltyProgramLogo } from "./LoyaltyProgramLogo";

describe("brand assets", () => {
  it("usa o asset oficial da MRL e reserva dimensões", () => {
    render(<BrandLogo size="medium" />);
    expect(screen.getByAltText("MRL Travel")).toHaveAttribute("src", OFFICIAL_BRAND_ASSET);
    expect(screen.getByAltText("MRL Travel")).toHaveAttribute("width", "112");
  });

  it("usa fallback textual somente quando a marca falha", () => {
    render(<BrandLogo size="small" />);
    fireEvent.error(screen.getByAltText("MRL Travel"));
    expect(screen.getByRole("img", { name: "MRL Travel" })).toHaveTextContent("MRL Travel");
  });

  it("Livelo usa o SVG real e só cai para fallback em erro", () => {
    render(<LoyaltyProgramLogo program={{ slug: "livelo", name: "Livelo" }} />);
    const logo = screen.getByAltText("Logo Livelo");
    expect(logo).toHaveAttribute("src", "/assets/loyalty-programs/logo-livelo.svg");
    fireEvent.error(logo);
    expect(screen.getByLabelText("Logo indisponível para Livelo")).toBeInTheDocument();
    expect(screen.getByText("LI")).toBeInTheDocument();
  });

  it("programa desconhecido mostra fallback sem request quebrado", () => {
    render(<LoyaltyProgramLogo program={{ name: "Programa X" }} />);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByText("PX")).toBeInTheDocument();
  });
});

import { render,screen } from "@testing-library/react";
import { describe,expect,it,vi } from "vitest";
import { ProtectedDataButton } from "./ProtectedDataButton";

vi.mock("@/services/management-terms",()=>({buildVaultClientUrl:(clientId:string)=>`http://192.168.0.25:7443/clients/${encodeURIComponent(clientId)}`}));

const clientId="123e4567-e89b-42d3-a456-426614174000";

describe("botao de dados protegidos",()=>{
  it("nao aparece sem vault_access",()=>{render(<ProtectedDataButton clientId={clientId} allowed={false}/>);expect(screen.queryByRole("link",{name:"Abrir dados protegidos"})).not.toBeInTheDocument();});
  it("abre somente o client_id em nova aba quando autorizado",()=>{render(<ProtectedDataButton clientId={clientId} allowed/>);const link=screen.getByRole("link",{name:"Abrir dados protegidos"});expect(link).toHaveAttribute("href",`http://192.168.0.25:7443/clients/${clientId}`);expect(link).toHaveAttribute("target","_blank");expect(link).toHaveAttribute("rel","noopener noreferrer");expect(link.getAttribute("href")).not.toMatch(/token|cpf|email|password/i);});
  it("mantem ajuda operacional no modo compacto",()=>{render(<ProtectedDataButton clientId={clientId} allowed compact state="pending"/>);expect(screen.getByRole("link",{name:"Cadastro aguardando sincronização com a Gestão"})).toBeInTheDocument();});
});

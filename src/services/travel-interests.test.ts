import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc } = vi.hoisted(()=>({rpc:vi.fn()}));
vi.mock("@/lib/supabase",()=>({supabase:{rpc}}));
import { getClientTravelInterests, saveTravelInterest } from "./travel-interests";

describe("travel interests service",()=>{
  beforeEach(()=>rpc.mockReset());
  it("sempre escopa a leitura administrativa pelo cliente",async()=>{
    rpc.mockResolvedValueOnce({data:{items:[],counts:{all:0,waiting:0,inProgress:0,completed:0,cancelled:0},total:0,limit:50,offset:0},error:null});
    await getClientTravelInterests("client-a","waiting");
    expect(rpc).toHaveBeenCalledWith("get_client_travel_interests_admin",{p_client_id:"client-a",p_status:"waiting",p_limit:50,p_offset:0});
  });
  it("envia campos públicos e internos somente à RPC administrativa versionada",async()=>{
    rpc.mockResolvedValueOnce({data:{id:"interest-a"},error:null});
    await saveTravelInterest({clientId:"client-a",destination:"Lisboa",details:"Viagem",status:"waiting",priority:"urgent",publicVisible:false,publicNote:"Publica",internalNote:"Interna"});
    expect(rpc).toHaveBeenCalledWith("upsert_travel_interest_v2",expect.objectContaining({p_client_id:"client-a",p_priority:"urgent",p_public_visible:false,p_public_note:"Publica",p_internal_note:"Interna"}));
  });
});

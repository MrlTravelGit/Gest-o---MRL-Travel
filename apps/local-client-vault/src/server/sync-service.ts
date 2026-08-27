import { readFileSync } from "node:fs";
import { config } from "./config.js";
import { unprotectDpapi } from "./dpapi.js";
import { markClientSyncFailed,markClientSyncPending,provisionClient,recordSyncEvent,type ProvisioningEvent } from "./vault-service.js";

async function rpc<T>(name:string,payload:Record<string,unknown>):Promise<T>{
  const api=process.env.VAULT_SUPABASE_URL,publishable=process.env.VAULT_SUPABASE_PUBLISHABLE_KEY;
  if(!api||!publishable)throw new Error("SYNC_NOT_CONFIGURED");
  const credential=JSON.parse(unprotectDpapi(readFileSync(config.agentCredentialPath)).toString("utf8")) as {accessToken?:string};
  if(!credential.accessToken)throw new Error("SYNC_CREDENTIAL_INVALID");
  const response=await fetch(`${api}/rest/v1/rpc/${name}`,{method:"POST",headers:{apikey:publishable,Authorization:`Bearer ${credential.accessToken}`,"Content-Type":"application/json"},body:JSON.stringify(payload)});
  if(!response.ok)throw new Error(`SYNC_REMOTE_${response.status}`);
  return response.json() as Promise<T>;
}

export async function syncClients(){
  const claimed=await rpc<{items?:ProvisioningEvent[]}>("claim_vault_provisioning_events_v1",{p_limit:50});
  let processed=0,failed=0;
  for(const event of claimed.items??[]){
    recordSyncEvent(event,"pending");
    let succeeded=false;
    try{provisionClient(event);succeeded=true;processed++;}
    catch{markClientSyncFailed(event);failed++;}
    finally{await rpc("acknowledge_vault_provisioning_event_v1",{p_event_id:event.eventId,p_succeeded:succeeded});}
  }
  return {claimed:claimed.items?.length??0,processed,failed};
}

export async function retryClientSync(clientId:string){
  try{markClientSyncPending(clientId);}catch(error){if(!(error instanceof Error)||error.message!=="NOT_FOUND")throw error;}
  await rpc("retry_vault_provisioning_client_v1",{p_client_id:clientId});
  return syncClients();
}

import { readFileSync } from "node:fs";
import { config } from "./config.js";
import { unprotectDpapi } from "./dpapi.js";
import { provisionClient } from "./vault-service.js";

type Event={eventId:string;clientId:string;displayName:string;contractStartDate:string|null;contractEndDate:string|null;eventType:string};
const apiValue=process.env.VAULT_SUPABASE_URL,publishableValue=process.env.VAULT_SUPABASE_PUBLISHABLE_KEY;
if(!apiValue||!publishableValue)throw new Error("Configure o endpoint Supabase do agente local.");
const api:string=apiValue,publishable:string=publishableValue;
const credential=JSON.parse(unprotectDpapi(readFileSync(config.agentCredentialPath)).toString("utf8")) as {accessToken:string};
async function rpc(name:string,payload:Record<string,unknown>){const response=await fetch(`${api}/rest/v1/rpc/${name}`,{method:"POST",headers:{apikey:publishable,Authorization:`Bearer ${credential.accessToken}`,"Content-Type":"application/json"},body:JSON.stringify(payload)});if(!response.ok)throw new Error(`Falha de sincronizacao: ${response.status}`);return response.json();}
export async function syncOnce(){const claimed=await rpc("claim_vault_provisioning_events_v1",{p_limit:50}) as {items?:Event[]};for(const event of claimed.items??[]){let success=false;try{provisionClient(event);success=true;}finally{await rpc("acknowledge_vault_provisioning_event_v1",{p_event_id:event.eventId,p_succeeded:success});}}return claimed.items?.length??0;}
syncOnce().then((count)=>process.stdout.write(`${count} evento(s) processado(s).\n`)).catch(()=>{process.stderr.write("Sincronizacao falhou; eventos permanecem para nova tentativa.\n");process.exitCode=1;});

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { config } from "./config.js";
import { unprotectDpapi } from "./dpapi.js";
import { markSyncFailed,provisionClient,recordSyncEvent } from "./vault-service.js";

type Event={eventId:string;clientId:string;displayName:string;contractStartDate:string|null;contractEndDate:string|null;eventType:string};
function agentConfig(){const api=process.env.VAULT_SUPABASE_URL,publishable=process.env.VAULT_SUPABASE_PUBLISHABLE_KEY;if(!api||!publishable)throw new Error("Configure o endpoint Supabase do agente local.");const credential=JSON.parse(unprotectDpapi(readFileSync(config.agentCredentialPath)).toString("utf8")) as {accessToken:string};return {api,publishable,credential};}
async function rpc(name:string,payload:Record<string,unknown>){const {api,publishable,credential}=agentConfig();const response=await fetch(`${api}/rest/v1/rpc/${name}`,{method:"POST",headers:{apikey:publishable,Authorization:`Bearer ${credential.accessToken}`,"Content-Type":"application/json"},body:JSON.stringify(payload)});if(!response.ok)throw new Error(`Falha de sincronizacao: ${response.status}`);return response.json();}
export async function syncOnce(){const claimed=await rpc("claim_vault_provisioning_events_v1",{p_limit:50}) as {items?:Event[]};for(const event of claimed.items??[]){recordSyncEvent(event,"pending");let success=false;try{provisionClient(event);success=true;}catch{markSyncFailed(event);}finally{await rpc("acknowledge_vault_provisioning_event_v1",{p_event_id:event.eventId,p_succeeded:success});}}return claimed.items?.length??0;}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){syncOnce().then((count)=>process.stdout.write(`${count} evento(s) processado(s).\n`)).catch(()=>{process.stderr.write("Sincronizacao falhou; eventos permanecem para nova tentativa.\n");process.exitCode=1;});}

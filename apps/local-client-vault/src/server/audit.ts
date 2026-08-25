import { randomUUID } from "node:crypto";
import { all,run } from "./database.js";

const forbidden=/password|senha|login|cpf|token|secret|key|documentContent|fileContent/i;
export function audit(input:{userId?:string|null;action:string;clientId?:string|null;objectType?:string;objectId?:string;result:"success"|"denied"|"failed";localAddress?:string|null;justification?:string|null;metadata?:Record<string,unknown>}){
  const safe=Object.fromEntries(Object.entries(input.metadata??{}).filter(([key])=>!forbidden.test(key)).map(([key,value])=>[key,typeof value==="string"?value.slice(0,200):value]));
  run("insert into vault_audit_events(event_id,timestamp,user_id,action,client_id,object_type,object_id,result,local_address,justification,metadata_json) values(?,?,?,?,?,?,?,?,?,?,?)",randomUUID(),new Date().toISOString(),input.userId??null,input.action,input.clientId??null,input.objectType??null,input.objectId??null,input.result,input.localAddress??null,input.justification?.slice(0,500)??null,JSON.stringify(safe));
}
export function listAudit(limit=200){return all<Record<string,unknown>>("select event_id,timestamp,user_id,action,client_id,object_type,object_id,result,local_address,justification,metadata_json from vault_audit_events order by timestamp desc limit ?",Math.min(Math.max(limit,1),500)).map(row=>({...row,metadata:JSON.parse(String(row.metadata_json||"{}")),metadata_json:undefined}));}

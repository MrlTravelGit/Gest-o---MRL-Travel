let csrf="";

const messages:Record<string,string>={
  NOT_FOUND:"Cliente não encontrado ou ainda não autorizado para este cofre.",
  INVALID_CLIENT_ID:"O identificador do cliente é inválido.",
  SESSION_REQUIRED:"Sua sessão expirou. Entre novamente.",
  FORBIDDEN:"Seu perfil não possui permissão para esta ação.",
  SYNC_NOT_CONFIGURED:"O agente local ainda não foi configurado para sincronizar com a Gestão.",
  SYNC_CREDENTIAL_INVALID:"A credencial do agente local precisa ser renovada.",
};

async function request<T>(path:string,options:RequestInit={}){
  const response=await fetch(`/api${path}`,{...options,credentials:"include",headers:{...(options.body instanceof ArrayBuffer?{}:{"Content-Type":"application/json"}),...(csrf?{"X-Vault-CSRF":csrf}:{}),...options.headers}});
  const type=response.headers.get("content-type")||"";
  const data=type.includes("application/json")?await response.json():await response.arrayBuffer();
  if(!response.ok){const code=String((data as {error?:string}).error||"");throw new Error(messages[code]||(/^SYNC_REMOTE_/.test(code)?"Não foi possível conectar o agente local à Gestão.":"Não foi possível concluir a operação no cofre local."));}
  return data as T;
}

export async function login(username:string,password:string){const result=await request<{csrf:string;user:VaultUser}>("/auth/login",{method:"POST",body:JSON.stringify({username,password})});csrf=result.csrf;return result;}
export async function session(){const result=await request<{user:VaultUser;csrf:string}>("/auth/session");csrf=result.csrf;return result;}
export const logout=()=>request("/auth/logout",{method:"POST",body:"{}"});
export const getAudit=()=>request<{items:Array<Record<string,unknown>>}>("/audit");
export const getClients=()=>request<{items:VaultClientSummary[];total:number}>("/clients");
export const getClient=(id:string)=>request<VaultClient>(`/clients/${id}`);
export const runClientSync=()=>request<SyncResult>("/sync/clients/run",{method:"POST",body:"{}"});
export const retryClientSync=(id:string)=>request<SyncResult>(`/clients/${id}/retry-sync`,{method:"POST",body:"{}"});
export const savePersonal=(id:string,value:Record<string,unknown>)=>request<VaultClient>(`/clients/${id}`,{method:"PUT",body:JSON.stringify(value)});
export const saveCredential=(clientId:string,value:Record<string,unknown>)=>request(`/clients/${clientId}/credentials`,{method:"POST",body:JSON.stringify(value)});
export const reveal=(clientId:string,id:string,field:"login"|"password",purpose:"reveal"|"copy")=>request<{value:string|null}>(`/clients/${clientId}/credentials/${id}/${field}`,{method:"POST",body:JSON.stringify({purpose})});
export const removeDocument=(clientId:string,id:string)=>request(`/clients/${clientId}/documents/${id}`,{method:"DELETE",body:"{}"});
export async function uploadDocument(clientId:string,file:File,meta:Record<string,unknown>){const encoded=btoa(unescape(encodeURIComponent(JSON.stringify({...meta,originalName:file.name,mimeType:file.type})))).replaceAll("+","-").replaceAll("/","_").replaceAll("=","");return request(`/clients/${clientId}/documents`,{method:"POST",body:await file.arrayBuffer(),headers:{"Content-Type":"application/octet-stream","X-Vault-Metadata":encoded}});}

export type VaultSyncStatus="synced"|"pending"|"failed"|"archived";
export interface VaultUser{id?:string;username?:string;role:string}
export interface SyncResult{claimed:number;processed:number;failed:number}
export interface VaultClientSummary{clientId:string;displayName:string;status:string;contractStartDate:string|null;contractEndDate:string|null;syncStatus:VaultSyncStatus;lastError:string|null;updatedAt:string;localDataAvailable:boolean}
export interface VaultClient extends VaultClientSummary{createdAt:string;lastAdminUserId:string|null;personal:{cpf:string|null;rg:string|null;birthDate:string|null;nextBirthday:string|null;email:string|null;phone:string|null;address:string|null;maritalStatus:string|null;passport:string|null;privateNotes:string|null};credentials:Array<{id:string;serviceName:string;serviceUrl:string;iconKey:string|null;status:string;changedAt:string;reviewOn:string|null}>;documents:Array<{id:string;title:string|null;originalName:string|null;documentType:string;expiresOn:string|null;sizeBytes:number;mimeType:string;createdAt:string}>}

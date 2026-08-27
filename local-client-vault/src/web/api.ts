let csrf="";
const messages:Record<string,string>={SESSION_REQUIRED:"Sua sessão expirou. Entre novamente.",FORBIDDEN:"Seu perfil não possui permissão para esta ação.",NOT_FOUND:"Cadastro protegido não encontrado.",CLIENT_NOT_SYNCED:"Cadastro aguardando sincronização com a Gestão.",INVALID_CLIENT_ID:"Identificador de cliente inválido.",FORBIDDEN_CARD_SECRET:"Por segurança, número completo, CVV, senhas e tokens bancários não podem ser armazenados.",ANTIMALWARE_UNAVAILABLE:"O Windows Defender precisa estar disponível para validar o arquivo."};
async function request<T>(path:string,options:RequestInit={}){const response=await fetch(`/api${path}`,{...options,credentials:"include",headers:{...(options.body instanceof ArrayBuffer?{}:{"Content-Type":"application/json"}),...(csrf?{"X-Vault-CSRF":csrf}:{}),...options.headers}}),type=response.headers.get("content-type")||"",data=type.includes("application/json")?await response.json():await response.arrayBuffer();if(!response.ok){const code=String((data as {error?:string}).error||"");throw new Error(messages[code]||"Não foi possível concluir a operação no cofre local.");}return data as T;}
export async function login(username:string,password:string){const result=await request<{csrf:string;user:VaultUser}>("/auth/login",{method:"POST",body:JSON.stringify({username,password})});csrf=result.csrf;return result;}
export async function session(){const result=await request<{user:VaultUser;csrf:string}>("/auth/session");csrf=result.csrf;return result;}
export const logout=()=>request("/auth/logout",{method:"POST",body:"{}"});
export const getAudit=()=>request<{items:Array<Record<string,unknown>>}>("/audit");
export const syncNow=()=>request<{ok:boolean;count:number}>("/sync",{method:"POST",body:"{}"});
export const getClients=()=>request<{items:VaultClientSummary[];total:number}>("/clients");
export const getClient=(id:string)=>request<VaultClient>(`/clients/${id}`);
export const savePersonal=(id:string,value:Record<string,unknown>)=>request<VaultClient>(`/clients/${id}`,{method:"PUT",body:JSON.stringify(value)});
export const saveCredential=(clientId:string,value:Record<string,unknown>)=>request(`/clients/${clientId}/credentials`,{method:"POST",body:JSON.stringify(value)});
export const saveCard=(clientId:string,value:Record<string,unknown>)=>request(`/clients/${clientId}/cards`,{method:"POST",body:JSON.stringify(value)});
export const savePassport=(clientId:string,value:Record<string,unknown>)=>request(`/clients/${clientId}/passports`,{method:"POST",body:JSON.stringify(value)});
export const saveVisa=(clientId:string,value:Record<string,unknown>)=>request(`/clients/${clientId}/visas`,{method:"POST",body:JSON.stringify(value)});
export const reveal=(clientId:string,id:string,field:"login"|"password",purpose:"reveal"|"copy")=>request<{value:string|null}>(`/clients/${clientId}/credentials/${id}/${field}`,{method:"POST",body:JSON.stringify({purpose})});
export const removeDocument=(clientId:string,id:string)=>request(`/clients/${clientId}/documents/${id}`,{method:"DELETE",body:"{}"});
export async function uploadDocument(clientId:string,file:File,meta:Record<string,unknown>){const encoded=btoa(unescape(encodeURIComponent(JSON.stringify({...meta,originalName:file.name,mimeType:file.type})))).replaceAll("+","-").replaceAll("/","_").replaceAll("=","");return request(`/clients/${clientId}/documents`,{method:"POST",body:await file.arrayBuffer(),headers:{"Content-Type":"application/octet-stream","X-Vault-Metadata":encoded}});}

export type VaultSyncStatus="synced"|"pending"|"failed"|"archived";
export interface VaultUser{id?:string;username?:string;role:string}
export interface VaultClientSummary{clientId:string;displayName:string;status:string;contractStartDate:string|null;contractEndDate:string|null;syncStatus:VaultSyncStatus;lastError:string|null;updatedAt:string;localDataAvailable:boolean}
export interface VaultCredential{id:string;serviceName:string;serviceUrl:string;iconKey:string|null;notes:string|null;status:string;changedAt:string;reviewOn:string|null;createdAt:string;updatedAt:string}
export interface VaultDocument{id:string;title:string|null;originalName:string|null;documentType:string;documentOn:string|null;expiresOn:string|null;countryCode:string|null;sizeBytes:number;mimeType:string;createdAt:string}
export interface VaultCard{id:string;bank:string;brand:string;cardName:string;lastFour:string;earningRate:string|null;earningCurrency:"USD"|"BRL"|null;destinationProgram:string|null;closingDay:number|null;dueDay:number|null;notes:string|null;createdAt:string;updatedAt:string}
export interface VaultPassport{id:string;number:string;issuerCountry:string|null;issuedOn:string|null;expiresOn:string|null;nationality:string|null;documentId:string|null;notes:string|null;createdAt:string;updatedAt:string}
export interface VaultVisa{id:string;visaType:string|null;country:string;issuedOn:string|null;expiresOn:string|null;passportId:string|null;documentId:string|null;notes:string|null;createdAt:string;updatedAt:string}
export interface VaultClient extends VaultClientSummary{createdAt:string;lastAdminUserId:string|null;personal:{cpf:string|null;rg:string|null;rgIssuer:string|null;birthDate:string|null;age:number|null;nextBirthday:string|null;email:string|null;phone:string|null;whatsapp:string|null;address:string|null;maritalStatus:string|null;nationality:string|null;privateNotes:string|null};credentials:VaultCredential[];documents:VaultDocument[];cards:VaultCard[];passports:VaultPassport[];visas:VaultVisa[]}

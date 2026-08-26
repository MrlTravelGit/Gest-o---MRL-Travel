import { createServer,type IncomingMessage,type ServerResponse } from "node:http";
import { existsSync,readFileSync } from "node:fs";
import { extname,join,resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { audit,listAudit } from "./audit.js";
import { authenticate,login,logout,rotateCsrf,type VaultRole } from "./auth.js";
import { config } from "./config.js";
import "./database.js";
import { deleteDocument,readDocument,storeDocument } from "./documents.js";
import { getClient,revealCredential,saveCredential,updatePersonal } from "./vault-service.js";

const webRoot=resolve(fileURLToPath(new URL("../dist/",import.meta.url)));
const cookie=(req:IncomingMessage,name:string)=>req.headers.cookie?.split(";").map((v:string)=>v.trim().split("=")).find(([key]:string[])=>key===name)?.[1];
const address=(req:IncomingMessage)=>req.socket.remoteAddress||"unknown";
const json=(res:ServerResponse,status:number,value:unknown,extra:Record<string,string>={})=>{res.writeHead(status,{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store",...extra});res.end(JSON.stringify(value));};
const securityHeaders={"X-Content-Type-Options":"nosniff","X-Frame-Options":"DENY","Referrer-Policy":"no-referrer","Permissions-Policy":"camera=(), microphone=(), geolocation=()","Content-Security-Policy":"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"};
async function body(req:IncomingMessage,limit=1024*1024){const chunks:Buffer[]=[];let size=0;for await(const chunk of req){const buffer=Buffer.from(chunk);size+=buffer.length;if(size>limit)throw new Error("PAYLOAD_TOO_LARGE");chunks.push(buffer);}return Buffer.concat(chunks);}
async function jsonBody(req:IncomingMessage){const raw=await body(req);return raw.length?JSON.parse(raw.toString("utf8")) as Record<string,unknown>:{};}
const requireRole=(role:VaultRole,allowed:VaultRole[])=>{if(!allowed.includes(role))throw new Error("FORBIDDEN");};

const server=createServer(async(req,res)=>{
  Object.entries(securityHeaders).forEach(([key,value])=>res.setHeader(key,value));
  const origin=req.headers.origin;
  if(origin&&config.allowedOrigins.has(origin)){res.setHeader("Access-Control-Allow-Origin",origin);res.setHeader("Access-Control-Allow-Credentials","true");res.setHeader("Vary","Origin");}
  if(origin&&!config.allowedOrigins.has(origin))return json(res,403,{error:"ORIGIN_NOT_ALLOWED"});
  if(req.method==="OPTIONS"){res.writeHead(204,{"Access-Control-Allow-Methods":"GET,POST,PUT,DELETE,OPTIONS","Access-Control-Allow-Headers":"Content-Type,X-Vault-CSRF,X-Vault-Metadata"});return res.end();}
  const url=new URL(req.url||"/",config.publicUrl);if(url.pathname==="/api/health"||url.pathname==="/health")return json(res,200,{status:"ok",service:"mrl-client-vault"});
  try{
    if(url.pathname==="/api/auth/login"&&req.method==="POST"){const input=await jsonBody(req);const result=await login(String(input.username||""),String(input.password||""),address(req));res.setHeader("Set-Cookie",`vault_session=${result.token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(config.sessionMaxMs/1000)}`);return json(res,200,{user:result.user,csrf:result.csrf,expiresAt:result.expiresAt});}
    const mutating=!['GET','HEAD'].includes(req.method||'GET');const session=authenticate(cookie(req,"vault_session"),String(req.headers["x-vault-csrf"]||""),mutating);
    if(url.pathname.startsWith("/api/")&&!session){audit({action:"api_access_denied",result:"denied",localAddress:address(req)});return json(res,401,{error:"SESSION_REQUIRED"});}
    if(url.pathname==="/api/auth/session"&&req.method==="GET")return json(res,200,{user:{id:session!.userId,username:session!.username,role:session!.role},csrf:rotateCsrf(session!.sessionId)});
    if(url.pathname==="/api/auth/logout"&&req.method==="POST"){logout(session!.sessionId,session!.userId,address(req));res.setHeader("Set-Cookie","vault_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0");return json(res,200,{ok:true});}
    if(url.pathname==="/api/audit"&&req.method==="GET"){requireRole(session!.role,["vault_admin","vault_auditor"]);return json(res,200,{items:listAudit(Number(url.searchParams.get("limit")||200))});}
    const clientMatch=url.pathname.match(/^\/api\/clients\/([0-9a-f-]{36})$/i);
    if(clientMatch&&req.method==="GET")return json(res,200,getClient(clientMatch[1],session!.role));
    if(clientMatch&&req.method==="PUT"){requireRole(session!.role,["vault_admin","vault_operator"]);return json(res,200,updatePersonal(clientMatch[1],await jsonBody(req),session!.userId));}
    const credentialSave=url.pathname.match(/^\/api\/clients\/([0-9a-f-]{36})\/credentials$/i);
    if(credentialSave&&req.method==="POST"){requireRole(session!.role,["vault_admin","vault_operator"]);return json(res,200,saveCredential(credentialSave[1],await jsonBody(req),session!.userId));}
    const reveal=url.pathname.match(/^\/api\/clients\/([0-9a-f-]{36})\/credentials\/([0-9a-f-]{36})\/(login|password)$/i);
    if(reveal&&req.method==="POST"){requireRole(session!.role,["vault_admin","vault_operator"]);return json(res,200,revealCredential(reveal[1],reveal[2],reveal[3] as "login"|"password",session!.userId,address(req)),{"Cache-Control":"no-store, no-cache, must-revalidate","Pragma":"no-cache"});}
    const documentCollection=url.pathname.match(/^\/api\/clients\/([0-9a-f-]{36})\/documents$/i);
    if(documentCollection&&req.method==="POST"){requireRole(session!.role,["vault_admin","vault_operator"]);const encoded=String(req.headers["x-vault-metadata"]||"");const meta=JSON.parse(Buffer.from(encoded,"base64url").toString("utf8")) as Record<string,unknown>;return json(res,201,storeDocument(documentCollection[1],meta,await body(req,config.maxFileBytes+1),session!.userId,address(req)));}
    const documentRead=url.pathname.match(/^\/api\/clients\/([0-9a-f-]{36})\/documents\/([0-9a-f-]{36})$/i);
    if(documentRead&&req.method==="GET"){requireRole(session!.role,["vault_admin","vault_operator"]);const file=readDocument(documentRead[1],documentRead[2],session!.userId,address(req));res.writeHead(200,{"Content-Type":file.mimeType,"Content-Disposition":"attachment; filename=documento-protegido","Cache-Control":"no-store","X-Content-Type-Options":"nosniff"});return res.end(file.bytes);}
    if(documentRead&&req.method==="DELETE"){requireRole(session!.role,["vault_admin"]);deleteDocument(documentRead[1],documentRead[2],session!.userId,address(req));return json(res,200,{ok:true});}
    if(url.pathname.startsWith("/api/"))return json(res,404,{error:"NOT_FOUND"});
    const requested=url.pathname==="/"?"index.html":url.pathname.replace(/^\//,"");const candidate=resolve(webRoot,requested);const path=candidate.startsWith(webRoot)&&existsSync(candidate)?candidate:join(webRoot,"index.html");const mime:Record<string,string>={".html":"text/html; charset=utf-8",".js":"text/javascript; charset=utf-8",".css":"text/css; charset=utf-8",".svg":"image/svg+xml",".png":"image/png"};res.writeHead(200,{"Content-Type":mime[extname(path)]||"application/octet-stream","Cache-Control":extname(path)===".html"?"no-store":"public, max-age=31536000, immutable"});res.end(readFileSync(path));
  }catch(error){const message=error instanceof Error?error.message:"INTERNAL_ERROR";const status=message==="FORBIDDEN"?403:message==="NOT_FOUND"||message==="CLIENT_NOT_SYNCED"?404:message==="PAYLOAD_TOO_LARGE"?413:400;audit({action:"request_failed",result:"failed",localAddress:address(req),metadata:{code:message}});json(res,status,{error:message});}
});
server.listen(config.port,config.host,()=>{process.stdout.write(`MRL Vault ativo em ${config.publicUrl}\n`);});

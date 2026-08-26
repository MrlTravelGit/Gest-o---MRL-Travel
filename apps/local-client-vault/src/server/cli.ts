import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { createFirstAdmin, createVaultUser, revokeAllSessions, setVaultUserActive, unlockVaultUser, type VaultRole } from "./auth.js";
import { createBackup, restoreBackup } from "./backup.js";
import { config } from "./config.js";
import { protectDpapi } from "./dpapi.js";
import { storeDocument } from "./documents.js";

const command=process.argv[2],prompt=createInterface({input:stdin,output:stdout});
const mime:Record<string,string>={".pdf":"application/pdf",".jpg":"image/jpeg",".jpeg":"image/jpeg",".png":"image/png",".webp":"image/webp",".txt":"text/plain",".docx":"application/vnd.openxmlformats-officedocument.wordprocessingml.document",".xlsx":"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"};
async function username(label:string){return (await prompt.question(label)).trim().toLowerCase();}
async function init(){const user=await username("Usuario do primeiro vault_admin: "),password=await prompt.question("Senha com pelo menos 15 caracteres: ");await createFirstAdmin(user,password);stdout.write("Administrador criado.\n");}
async function createUser(){const user=await username("Novo usuario: "),role=await prompt.question("Perfil (vault_admin | vault_operator | vault_auditor): ") as VaultRole,password=await prompt.question("Senha com pelo menos 15 caracteres: ");await createVaultUser(user,password,role);stdout.write("Usuario criado.\n");}
async function setAgent(){const token=await prompt.question("Access token da identidade tecnica exclusiva: ");writeFileSync(config.agentCredentialPath,protectDpapi(Buffer.from(JSON.stringify({accessToken:token.trim()}))),{mode:0o600});stdout.write("Credencial do agente protegida pelo DPAPI.\n");}
function scan(root:string){return readdirSync(root,{withFileTypes:true}).filter((entry)=>entry.isDirectory()).map((folder)=>{const dir=join(root,folder.name);const files=readdirSync(dir,{withFileTypes:true}).filter((entry)=>entry.isFile()).map((file)=>{const path=join(dir,file.name),type=mime[extname(file.name).toLowerCase()]||null;return{name:file.name,sizeBytes:statSync(path).size,mimeType:type,status:type?"allowed":"blocked"};});return{folder:folder.name,path:dir,files};});}
async function importFolders(){const root=resolve(process.argv[3]||"");if(!existsSync(root))throw new Error("Selecione uma pasta raiz existente.");const report=scan(root),reportPath=join(config.dataDir,`import-preview-${Date.now()}.json`);writeFileSync(reportPath,JSON.stringify({root,generatedAt:new Date().toISOString(),folders:report},null,2),{mode:0o600});stdout.write(`Previa criada sem importar arquivos: ${reportPath}\n`);const mappingPath=process.argv.find((arg)=>arg.startsWith("--mapping="))?.slice(10);if(!process.argv.includes("--apply"))return;if(!mappingPath)throw new Error("Informe --mapping=arquivo.json.");const mapping=JSON.parse(readFileSync(resolve(mappingPath),"utf8")) as Record<string,string>;const confirmation=await prompt.question(`Digite IMPORTAR ${report.length} PASTAS para confirmar: `);if(confirmation!==`IMPORTAR ${report.length} PASTAS`)throw new Error("Importacao cancelada.");for(const folder of report){const clientId=mapping[folder.folder];if(!clientId)continue;for(const file of folder.files.filter((item)=>item.status==="allowed"))storeDocument(clientId,{title:file.name,originalName:file.name,documentType:"Outro",mimeType:file.mimeType},readFileSync(join(folder.path,file.name)),"local-import","127.0.0.1");}}
try {
  if(command==="init-admin")await init(); else if(command==="create-user")await createUser();
  else if(command==="unlock-user"){unlockVaultUser(await username("Usuario para desbloquear: "));stdout.write("Usuario desbloqueado.\n");}
  else if(command==="disable-user"){setVaultUserActive(await username("Usuario para desativar: "),false);stdout.write("Usuario desativado e sessoes revogadas.\n");}
  else if(command==="enable-user"){setVaultUserActive(await username("Usuario para ativar: "),true);stdout.write("Usuario ativado.\n");}
  else if(command==="revoke-sessions"){revokeAllSessions();stdout.write("Sessoes revogadas.\n");}
  else if(command==="set-agent-credential")await setAgent(); else if(command==="backup")stdout.write(`${JSON.stringify(createBackup())}\n`); else if(command==="restore")stdout.write(`${JSON.stringify(restoreBackup(process.argv[3]||"",process.argv[4]||""))}\n`); else if(command==="import-folders")await importFolders(); else throw new Error("Comando invalido.");
} finally { prompt.close(); }

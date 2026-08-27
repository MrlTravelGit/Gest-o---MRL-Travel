import { syncClients } from "./sync-service.js";

syncClients().then((result)=>process.stdout.write(`${result.processed} evento(s) processado(s); ${result.failed} falha(s).\n`)).catch(()=>{process.stderr.write("Sincronizacao falhou; eventos permanecem para nova tentativa.\n");process.exitCode=1;});

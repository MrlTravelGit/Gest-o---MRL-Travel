import { rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
for (const name of ["dist", "dist-server"]) {
  const target = resolve(root, name);
  if (dirname(target) !== root) throw new Error(`Diretorio de build invalido: ${target}`);
  rmSync(target, { recursive: true, force: true });
}

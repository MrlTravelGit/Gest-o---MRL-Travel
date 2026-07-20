import { basename, dirname, resolve } from "node:path";
import { existsSync, lstatSync, readdirSync, rmdirSync, unlinkSync } from "node:fs";

const workspace = resolve(".");
const target = resolve(workspace, "dist");

if (dirname(target) !== workspace || basename(target) !== "dist") {
  throw new Error(`Diretório de build inesperado: ${target}`);
}

removeTree(target);

if (existsSync(target)) {
  throw new Error(`Não foi possível limpar o diretório de build: ${target}`);
}

function removeTree(path) {
  if (!existsSync(path)) return;
  if (!lstatSync(path).isDirectory()) {
    unlinkSync(path);
    return;
  }
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    removeTree(resolve(path, entry.name));
  }
  rmdirSync(path);
}

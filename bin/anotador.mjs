#!/usr/bin/env node
// Lançador: confere a versão do Node e reexecuta o servidor TypeScript com os flags certos.
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const [maior = 0, menor = 0] = process.versions.node.split(".").map(Number);
if (maior < 22 || (maior === 22 && menor < 18)) {
  console.error(`anotador-ui exige Node >= 22.18 (atual: ${process.versions.node}).`);
  process.exit(1);
}

const raiz = dirname(dirname(fileURLToPath(import.meta.url)));
const filho = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", join(raiz, "server.ts"), ...process.argv.slice(2)], {
  stdio: "inherit",
});
filho.on("exit", (codigo, sinal) => process.exit(codigo ?? (sinal ? 1 : 0)));
for (const sinal of ["SIGINT", "SIGTERM"]) process.on(sinal, () => filho.kill(sinal));

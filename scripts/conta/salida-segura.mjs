#!/usr/bin/env node
// scripts/conta/salida-segura.mjs
//
// D01 · R2 punto 1 · La puerta de salida (ver lib/salidaSegura.mjs). Lee la
// salida de un paso por la entrada estándar y escribe solo lo que pasa:
//
//   npx tsx script.ts 2>&1 | node scripts/conta/salida-segura.mjs | tee -a "$GITHUB_STEP_SUMMARY"
//
// Se come la traza de los errores a propósito: si el paso falla, el código de
// salida lo dice (pipefail) y la causa se mira a mano, no en un registro público.

import { enMarkdown, filtrar } from './lib/salidaSegura.mjs'

let entrada = ''
process.stdin.setEncoding('utf8')
for await (const trozo of process.stdin) entrada += trozo
process.stdout.write(enMarkdown(filtrar(entrada)))

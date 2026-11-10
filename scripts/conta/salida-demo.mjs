#!/usr/bin/env node
// scripts/conta/salida-demo.mjs
//
// GD · nº94 · La puerta de la DEMO (ver lib/salidaDemo.mjs): deja pasar al resumen
// del run los pasos del «comprobar» de la Gestoría Demo, con su texto. Solo en el
// job «comprobar» de gd-video-qbo.yml (lo vigila workflows-salida.mjs) y solo si
// el paso lo pide con PUERTA_DEMO=gd-comprobar:
//
//   cat comprobar-salida/resumen.txt | PUERTA_DEMO=gd-comprobar node scripts/conta/salida-demo.mjs >> "$GITHUB_STEP_SUMMARY"

import { demoEnMarkdown, filtrarDemo } from './lib/salidaDemo.mjs'

if (process.env.PUERTA_DEMO !== 'gd-comprobar') {
  process.stderr.write('La puerta de la demo solo se abre en el «comprobar» de la Gestoría Demo (PUERTA_DEMO=gd-comprobar).\n')
  process.exit(2)
}
let entrada = ''
process.stdin.setEncoding('utf8')
for await (const trozo of process.stdin) entrada += trozo
process.stdout.write(demoEnMarkdown(filtrarDemo(entrada)))

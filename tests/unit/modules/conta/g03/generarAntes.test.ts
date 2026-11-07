// tests/unit/modules/conta/g03/generarAntes.test.ts
//
// G03 · Saca la foto de «antes» (foodint-antes.json) con la vara de
// medirMenu.ts. Solo corre con G03_GENERAR=1, y se corrió sobre `main`
// (45585d8), con el contexto tal como lo arma allí esqueletoService.ts:
//   hosteleria: fila?.is_hospitality === true,  asesoria: await esAsesoria(…)
// y la tarjeta de Cobros de gestoria/paginas.tsx: conta_despacho_soy (= asesoria).

import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { it } from 'vitest'
import { foto, medir } from './medirMenu'
import { HOY } from './poblacion'

it.runIf(process.env.G03_GENERAR === '1')('saca la foto de antes', () => {
  const porEmpresa = Object.fromEntries(HOY.map((e) => [e.quien, medir(e,
    (fila, asesoria) => ({ hosteleria: fila.is_hospitality === true, asesoria }),
    (ctx) => ctx.asesoria === true)]))
  writeFileSync(join(__dirname, 'foto-antes.json'), `${JSON.stringify(foto(porEmpresa), null, 1)}\n`)
})
